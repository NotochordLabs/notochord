import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Abi, Address, Hex, PublicClient, WalletClient } from "viem";
import fossilArtifact from "./artifacts/Fossil.json";
import generationArtifact from "./artifacts/Generation.json";
import { waitForReceipt } from "./deploy";
import {
  chainHash,
  closeGeneration,
  createPopulation,
  deserialize,
  everyone,
  fitnessOf,
  HOUR,
  inputHash,
  serialize,
  thoughtBytes,
  type Lab,
  type Population,
  type Rules,
  type SavedPopulation,
} from "./engine";
import { roundAt, type Drand, type MarketSource, type MarketView } from "./sources";

const GENERATION_ABI = generationArtifact.abi as Abi;
const FOSSIL_ABI = fossilArtifact.abi as Abi;

/** Must match the Phase enum in Generation.sol. */
const enum Phase {
  AwaitingGenesisCommit,
  AwaitingGenesis,
  Ready,
  Open,
  Finished,
}

export const FOSSIL_BATCH = 8;

export interface Ctx {
  lab: Lab;
  rules: Rules;
  seed: string;
  startMs: number;
  now: () => number;
  drand: Drand;
  market: MarketSource;
  publicClient: PublicClient;
  wallet: WalletClient;
  onGas?: (fn: string, gas: bigint, fee: bigint) => void;
  /** Test hook: runs after state is saved and before the transaction is sent. */
  beforeSend?: (fn: string) => void;
}

interface Saved {
  population: SavedPopulation;
  pending: SavedPopulation | null;
}

const hex = (b: Uint8Array) => `0x${Buffer.from(b).toString("hex")}` as Hex;

/**
 * One replicate. The chain says which step comes next, so the runner holds no
 * schedule of its own and can stop and restart at any point. Each call to
 * `step` sends at most one transaction.
 */
export class Replicate {
  private population: Population | null = null;
  private pending: Population | null = null;

  constructor(
    private readonly ctx: Ctx,
    readonly index: number,
    readonly generationAddress: Address,
    readonly fossilAddress: Address,
    private readonly statePath: string,
  ) {
    if (existsSync(statePath)) {
      const saved = JSON.parse(readFileSync(statePath, "utf8")) as Saved;
      this.population = deserialize(ctx.lab, saved.population);
      this.pending = saved.pending ? deserialize(ctx.lab, saved.pending) : null;
    }
  }

  private get seed() {
    return `${this.ctx.seed}/r${this.index}`;
  }

  /** Written before the transaction that depends on it: a crash can only leave us ahead of the chain. */
  private save() {
    mkdirSync(dirname(this.statePath), { recursive: true });
    const body: Saved = { population: serialize(this.population!), pending: this.pending ? serialize(this.pending) : null };
    writeFileSync(`${this.statePath}.tmp`, JSON.stringify(body));
    renameSync(`${this.statePath}.tmp`, this.statePath);
  }

  private read<T>(functionName: string, args: unknown[] = []) {
    return this.ctx.publicClient.readContract({ address: this.generationAddress, abi: GENERATION_ABI, functionName, args }) as Promise<T>;
  }

  private readFossil<T>(functionName: string, args: unknown[] = []) {
    return this.ctx.publicClient.readContract({ address: this.fossilAddress, abi: FOSSIL_ABI, functionName, args }) as Promise<T>;
  }

  private async send(address: Address, abi: Abi, functionName: string, args: unknown[]) {
    const account = this.ctx.wallet.account!;
    const { request } = await this.ctx.publicClient.simulateContract({ address, abi, functionName, args, account });
    this.ctx.beforeSend?.(functionName);
    const hash = await this.ctx.wallet.writeContract(request);
    const receipt = await waitForReceipt(this.ctx.publicClient, hash);
    if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
    this.ctx.onGas?.(functionName, receipt.gasUsed, receipt.gasUsed * receipt.effectiveGasPrice);
  }

  private tx(functionName: string, args: unknown[]) {
    return this.send(this.generationAddress, GENERATION_ABI, functionName, args);
  }

  private hourMs(generation: number, hour: number) {
    return this.ctx.startMs + (generation * this.ctx.rules.hoursPerGeneration + hour) * HOUR;
  }

  private async view(): Promise<MarketView> {
    return this.ctx.market(this.ctx.now());
  }

  private need(view: MarketView, ms: number): number {
    const i = view.indexOf(ms);
    if (i === null) throw new Error(`Candle missing: ${new Date(ms).toISOString()}`);
    return i;
  }

  /** @returns true if a transaction was sent, so there may be more to do right away. */
  async step(): Promise<boolean> {
    const { rules, now } = this.ctx;
    const phase = Number(await this.read<number>("phase")) as Phase;

    if (phase === Phase.AwaitingGenesisCommit) {
      if (this.ctx.startMs <= now()) throw new Error("Start time has passed: deploy with a new startMs.");
      await this.tx("commitGenesis", [roundAt(this.ctx.startMs)]);
      return true;
    }

    if (phase === Phase.AwaitingGenesis) {
      const round = await this.read<bigint>("genesisDrandRound");
      const randomness = await this.ctx.drand.get(round, now());
      if (!randomness) return false;
      this.population ??= createPopulation(this.ctx.lab, this.seed, randomness, rules);
      this.save();
      await this.tx("recordGenesis", [randomness, this.population.selection.map(chainHash), this.population.control.map(chainHash)]);
      return true;
    }

    await this.reconcile();
    const p = this.population!;

    if (phase === Phase.Ready) {
      if (await this.recordFossilBatch(p)) return true;
      if (now() < this.hourMs(p.generation, 1)) return false;
      await this.checkAgainstChain(p);
      // Published only once the generation's last candle has closed, so the value
      // that seeds reproduction cannot be known while decisions are being made.
      // After a long outage the planned round has passed and the contract would refuse it
      // for good. A later round is still unknowable now, which is the only thing that matters.
      await this.tx("open", [roundAt(Math.max(this.hourMs(p.generation + 1, 1), now() + HOUR))]);
      return true;
    }

    if (phase === Phase.Open) {
      const hour = Number(await this.read<number>("hoursRecorded"));
      if (hour < rules.hoursPerGeneration) {
        const candleMs = this.hourMs(p.generation, hour);
        if (now() < candleMs + HOUR) return false;
        const view = await this.view();
        const i = this.need(view, candleMs);
        const { decisions, fired } = thoughtBytes(this.ctx.lab, p, view.market, i);
        await this.tx("recordThought", [hour, inputHash(view.market, i), hex(decisions), hex(fired)]);
        return true;
      }
      const closeAt = this.hourMs(p.generation + 1, 1);
      if (now() < closeAt) return false;
      const record = await this.read<{ drandRound: bigint }>("recordOf", [BigInt(p.generation)]);
      const randomness = await this.ctx.drand.get(record.drandRound, now());
      if (!randomness) return false;
      const view = await this.view();
      const startIndex = this.need(view, this.hourMs(p.generation, 0));
      this.need(view, this.hourMs(p.generation + 1, 0)); // the last hour's return needs this close
      const c = closeGeneration(this.ctx.lab, p, view.market, startIndex, this.seed, randomness, rules);
      this.pending = c.next;
      this.save();
      await this.tx("close", [randomness, c.selectionFitness, c.controlFitness, c.controlEliminated, c.selectionChildren, c.controlChildren]);
      return true;
    }

    // Finished
    if (await this.recordFossilBatch(p)) return true;
    if ((await this.read<Hex>("holdoutHash")) !== `0x${"0".repeat(64)}`) return false;
    const holdoutStart = this.hourMs(rules.generations, 0);
    const lastReturn = holdoutStart + rules.holdoutHours * HOUR;
    if (now() < lastReturn + HOUR) return false;
    const view = await this.view();
    const start = this.need(view, holdoutStart);
    this.need(view, lastReturn);
    const week = view.market.candles.slice(start, start + rules.holdoutHours + 1).map((k) => [k.t, k.c, k.v]);
    const weekHash = hashJson(week);
    await this.tx("recordHoldout", [
      weekHash,
      fitnessOf(this.ctx.lab, p.selection, view.market, start, rules.holdoutHours),
      fitnessOf(this.ctx.lab, p.control, view.market, start, rules.holdoutHours),
    ]);
    return true;
  }

  /** Catches up if we stopped between a confirmed close and the next save. */
  private async reconcile() {
    const chainGeneration = Number(await this.read<number>("generation"));
    if (!this.population) throw new Error(`Replicate ${this.index}: no state file (${this.statePath}).`);
    if (this.pending && this.pending.generation === chainGeneration) {
      this.population = this.pending;
      this.pending = null;
      this.save();
    }
    if (this.population.generation !== chainGeneration) {
      throw new Error(`Replicate ${this.index}: local generation ${this.population.generation}, chain ${chainGeneration}.`);
    }
  }

  /** Stops rather than writes if the saved population has drifted from the chain. */
  private async checkAgainstChain(p: Population) {
    const same = (a: readonly number[], b: { id: number }[]) => a.length === b.length && a.every((x, i) => Number(x) === b[i].id);
    if (!same(await this.read<number[]>("selection"), p.selection) || !same(await this.read<number[]>("control"), p.control)) {
      throw new Error(`Replicate ${this.index}: population does not match the chain, stopped.`);
    }
  }

  private async recordFossilBatch(p: Population): Promise<boolean> {
    const g = p.generation;
    if (!(await this.readFossil<boolean>("isFossilGeneration", [g])) || (await this.readFossil<boolean>("isComplete", [g]))) return false;
    const missing = [];
    for (const s of everyone(p)) {
      if (!(await this.readFossil<boolean>("recorded", [BigInt(g), BigInt(s.id)]))) missing.push(s);
      if (missing.length === FOSSIL_BATCH) break;
    }
    await this.send(this.fossilAddress, FOSSIL_ABI, "record", [g, missing.map((s) => s.id), missing.map((s) => hex(s.genome))]);
    return true;
  }
}

export function hashJson(value: unknown): Hex {
  return `0x${createSha(JSON.stringify(value))}`;
}

const createSha = (text: string) => createHash("sha256").update(text).digest("hex");
