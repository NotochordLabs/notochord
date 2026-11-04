// The Lab's operator: turns Bred events into born children once their drand round
// is out, and into race results once their day has closed. It is a separate
// process with its own wallet. It reads the experiment's fossils and never writes
// to the experiment.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Abi, Address, Hex, PublicClient, WalletClient } from "viem";
import type { Connectome } from "../src/connectome";
import { layoutFor, type Layout } from "../src/genome";
import { buildMarket, type Candle } from "../src/market";
import { detectRoles, type Roles } from "../src/roles";
import { waitForReceipt } from "../runner/deploy";
import type { Drand } from "../runner/sources";
import labArtifact from "./artifacts/LabHabitat.json";
import { LAB_RACE_HOURS, labChild, labGenomeHash, labRace } from "./core";

export const labAbi = labArtifact.abi as Abi;
const fossilAbi = [
  {
    type: "function",
    name: "genomeOf",
    stateMutability: "view",
    inputs: [{ type: "uint32" }, { type: "uint32" }],
    outputs: [{ type: "bytes" }],
  },
] as const satisfies Abi;

export const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** Hours of history the brain needs before its first thought (the 24h volume average). */
const WARMUP = 24;
const BATCH = 40;

export interface LabManifest {
  name: string;
  chainId: number;
  lab: Address;
  deployBlock: string;
  token: Address;
  operator: Address;
  coin: string;
  dayZeroMs: number;
  breedCost: string;
  maxPerDay: number;
  rulesHash: Hex;
  /** The experiment's real-wiring Fossil contracts, in the order the Lab indexes them. */
  fossils: Address[];
}

export enum Kind {
  Fossil = 0,
  Lab = 1,
}
export enum Status {
  None = 0,
  Bred = 1,
  Born = 2,
  Raced = 3,
}

export interface ParentRef {
  kind: Kind;
  source: number;
  generation: number;
  id: number;
}

/** Everything about one Lab brain, rebuilt from chain events. Published as the Lab archive. */
export interface LabBrain {
  id: number;
  breeder: Address;
  day: number;
  drandRound: string;
  parents: [ParentRef, ParentRef];
  parentHashes: [Hex, Hex];
  burned: string;
  bredTx: Hex;
  status: Status;
  randomness?: Hex;
  genomeHash?: Hex;
  genome?: string; // hex, for anyone who wants to replay it
  result?: { pnl: number; maxDrawdown: number; fitness: number; decisionsHash: Hex; decisions: string };
}

/** Candles covering [fromMs, toMs), oldest first. */
export type CandleSource = (coin: string, fromMs: number, toMs: number) => Promise<Candle[]>;

export const hyperliquidCandles: CandleSource = async (coin, fromMs, toMs) => {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval: "1h", startTime: fromMs, endTime: toMs - 1 } }),
  });
  if (!res.ok) throw new Error(`Hyperliquid ${res.status}`);
  const rows = (await res.json()) as { t: number; c: string; v: string }[];
  return rows.map((k) => ({ t: k.t, c: Number(k.c), v: Number(k.v) }));
};

/**
 * The market for one race day: the day's 24 hours, the warm-up before them and the
 * close after them. The window is fixed by the day alone, so the runner and anyone
 * verifying later build the same numbers.
 */
export async function raceMarket(candles: CandleSource, coin: string, dayStartMs: number) {
  const from = dayStartMs - WARMUP * HOUR;
  const to = dayStartMs + (LAB_RACE_HOURS + 1) * HOUR;
  const rows = (await candles(coin, from, to)).filter((k) => k.t >= from && k.t < to).sort((a, b) => a.t - b.t);
  const expected = WARMUP + LAB_RACE_HOURS + 1;
  if (rows.length !== expected) throw new Error(`Race day ${new Date(dayStartMs).toISOString()}: ${rows.length} of ${expected} candles`);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].t !== from + i * HOUR) throw new Error(`Race day ${new Date(dayStartMs).toISOString()}: gap at ${new Date(rows[i].t).toISOString()}`);
  }
  return { market: buildMarket(rows, `Hyperliquid ${coin} 1h`, false), start: WARMUP };
}

export interface LabCtx {
  publicClient: PublicClient;
  wallet?: WalletClient;
  manifest: LabManifest;
  connectome: Connectome;
  drand: Drand;
  candles: CandleSource;
  now: () => number;
  dir: string;
  log: (msg: string) => void;
}

const sha = (b: Uint8Array) => `0x${createHash("sha256").update(b).digest("hex")}` as Hex;
const toHex = (b: Uint8Array) => `0x${Buffer.from(b).toString("hex")}` as Hex;
const fromHex = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));

export class LabRunner {
  private layout: Layout;
  private roles: Roles;
  private brains = new Map<number, LabBrain>();
  private fossilGenomes = new Map<string, Uint8Array>();
  private scanned: bigint;

  constructor(private ctx: LabCtx) {
    this.layout = layoutFor(ctx.connectome);
    this.roles = detectRoles(ctx.connectome);
    this.scanned = BigInt(ctx.manifest.deployBlock);
    const saved = join(ctx.dir, "archive.json");
    if (existsSync(saved)) {
      const a = JSON.parse(readFileSync(saved, "utf8")) as { scannedTo: string; brains: LabBrain[] };
      for (const b of a.brains) this.brains.set(b.id, b);
      this.scanned = BigInt(a.scannedTo);
    }
  }

  get all(): LabBrain[] {
    return [...this.brains.values()].sort((a, b) => a.id - b.id);
  }

  dayStartMs(day: number) {
    return this.ctx.manifest.dayZeroMs + day * DAY;
  }

  /** Reads new events, then does whatever is due. Returns how many brains moved forward. */
  async step(): Promise<number> {
    await this.sync();
    const moved = (await this.births()) + (await this.results());
    this.save();
    return moved;
  }

  /** New Bred, Born and Raced events since the last scan, in block order. */
  async sync() {
    const { publicClient, manifest } = this.ctx;
    const head = await publicClient.getBlockNumber({ cacheTime: 0 }); // the cached value can lag behind our own writes
    const span = 5_000n;
    for (let from = this.scanned + 1n; from <= head; from += span) {
      const to = from + span - 1n > head ? head : from + span - 1n;
      const logs = await publicClient.getContractEvents({ address: manifest.lab, abi: labAbi, fromBlock: from, toBlock: to });
      for (const l of logs) this.apply(l as unknown as { eventName: string; args: Record<string, unknown>; transactionHash: Hex });
      this.scanned = to;
    }
  }

  private apply(l: { eventName: string; args: Record<string, unknown>; transactionHash: Hex }) {
    const a = l.args;
    const id = Number(a.id);
    if (l.eventName === "Bred") {
      const ref = (p: { kind: number; source: number; generation: number; id: number }): ParentRef => ({
        kind: Number(p.kind),
        source: Number(p.source),
        generation: Number(p.generation),
        id: Number(p.id),
      });
      this.brains.set(id, {
        id,
        breeder: a.breeder as Address,
        day: Number(a.day),
        drandRound: String(a.drandRound),
        parents: [ref(a.a as never), ref(a.b as never)],
        parentHashes: [a.parentA as Hex, a.parentB as Hex],
        burned: String(a.burned),
        bredTx: l.transactionHash,
        status: Status.Bred,
      });
    } else if (l.eventName === "Born") {
      const b = this.brains.get(id);
      if (!b) return;
      b.status = Status.Born;
      b.randomness = a.drandRandomness as Hex;
      b.genomeHash = a.genomeHash as Hex;
    } else if (l.eventName === "Raced") {
      const b = this.brains.get(id);
      if (!b) return;
      b.status = Status.Raced;
      b.result = {
        ...(b.result ?? { decisions: "" }),
        pnl: Number(a.pnl),
        maxDrawdown: Number(a.maxDrawdown),
        fitness: Number(a.fitness),
        decisionsHash: a.decisionsHash as Hex,
      };
    }
  }

  /** A parent's genome, checked against the hash the Lab recorded for it. */
  async parentGenome(p: ParentRef, expected: Hex): Promise<Uint8Array> {
    let g: Uint8Array;
    if (p.kind === Kind.Lab) {
      g = await this.genomeOf(p.id);
    } else {
      const key = `${p.source}/${p.generation}/${p.id}`;
      let cached = this.fossilGenomes.get(key);
      if (!cached) {
        const hex = (await this.ctx.publicClient.readContract({
          address: this.ctx.manifest.fossils[p.source],
          abi: fossilAbi,
          functionName: "genomeOf",
          args: [p.generation, p.id],
        })) as Hex;
        cached = fromHex(hex);
        this.fossilGenomes.set(key, cached);
      }
      g = cached;
    }
    if (sha(g) !== expected.toLowerCase()) throw new Error(`Parent ${JSON.stringify(p)} does not match its recorded hash`);
    return g;
  }

  /** A Lab brain's genome, rebuilt from its parents and randomness if not cached. */
  async genomeOf(id: number): Promise<Uint8Array> {
    const b = this.brains.get(id);
    if (!b || !b.randomness) throw new Error(`Lab brain ${id} is not born`);
    if (b.genome) return fromHex(b.genome);
    const g = labChild(
      await this.parentGenome(b.parents[0], b.parentHashes[0]),
      await this.parentGenome(b.parents[1], b.parentHashes[1]),
      id,
      b.randomness,
    );
    b.genome = toHex(g);
    return g;
  }

  private async births(): Promise<number> {
    const now = this.ctx.now();
    const due: { b: LabBrain; randomness: Hex; genome: Uint8Array }[] = [];
    for (const b of this.all) {
      if (b.status !== Status.Bred) continue;
      // One brain that cannot be built yet (a read failed, drand slow) must not hold back the rest.
      try {
        const randomness = await this.ctx.drand.get(BigInt(b.drandRound), now);
        if (!randomness) continue;
        const genome = labChild(
          await this.parentGenome(b.parents[0], b.parentHashes[0]),
          await this.parentGenome(b.parents[1], b.parentHashes[1]),
          b.id,
          randomness,
        );
        due.push({ b, randomness, genome });
      } catch (e) {
        this.ctx.log(`brain ${b.id} not born yet: ${(e as Error).message}`);
      }
    }
    for (let i = 0; i < due.length; i += BATCH) {
      const chunk = due.slice(i, i + BATCH);
      await this.send("recordBirths", [chunk.map((x) => x.b.id), chunk.map((x) => x.randomness), chunk.map((x) => labGenomeHash(x.genome))]);
      for (const x of chunk) {
        x.b.status = Status.Born;
        x.b.randomness = x.randomness;
        x.b.genome = toHex(x.genome);
        x.b.genomeHash = labGenomeHash(x.genome);
      }
      this.ctx.log(`born: ${chunk.map((x) => x.b.id).join(", ")}`);
    }
    return due.length;
  }

  private async results(): Promise<number> {
    const now = this.ctx.now();
    const byDay = new Map<number, LabBrain[]>();
    for (const b of this.all) {
      if (b.status !== Status.Born) continue;
      if (now < this.dayStartMs(b.day + 1) + HOUR + 5 * 60_000) continue; // a few minutes for the last candle to settle
      byDay.set(b.day, [...(byDay.get(b.day) ?? []), b]);
    }
    let moved = 0;
    for (const [day, list] of byDay) {
      // Each day stands alone: missing candles for one day must not hold back another.
      let races: { b: LabBrain; r: ReturnType<typeof labRace> }[];
      try {
        const { market, start } = await raceMarket(this.ctx.candles, this.ctx.manifest.coin, this.dayStartMs(day));
        races = [];
        for (const b of list) races.push({ b, r: labRace(this.ctx.connectome, this.layout, this.roles, await this.genomeOf(b.id), market, start) });
      } catch (e) {
        this.ctx.log(`day ${day} not raced yet: ${(e as Error).message}`);
        continue;
      }
      for (let i = 0; i < races.length; i += BATCH) {
        const chunk = races.slice(i, i + BATCH);
        await this.send("recordResults", [
          chunk.map((x) => x.b.id),
          chunk.map((x) => x.r.pnl),
          chunk.map((x) => x.r.maxDrawdown),
          chunk.map((x) => x.r.decisionsHash),
        ]);
        for (const { b, r } of chunk) {
          b.status = Status.Raced;
          b.result = { pnl: r.pnl, maxDrawdown: r.maxDrawdown, fitness: r.fitness, decisionsHash: r.decisionsHash, decisions: toHex(r.decisions) };
        }
        this.ctx.log(`raced day ${day}: ${chunk.map((x) => `${x.b.id}=${x.r.fitness}`).join(", ")}`);
        moved += chunk.length;
      }
    }
    return moved;
  }

  private async send(functionName: string, args: unknown[]) {
    const { wallet, publicClient, manifest } = this.ctx;
    if (!wallet) throw new Error("Read-only Lab runner cannot write.");
    const hash = await wallet.writeContract({ address: manifest.lab, abi: labAbi, functionName, args, account: wallet.account!, chain: wallet.chain });
    const receipt = await waitForReceipt(publicClient, hash);
    if (receipt.status !== "success") throw new Error(`${functionName} failed: ${hash}`);
  }

  /** The archive the site and verifiers read: every brain, its parents, genome and result. */
  save() {
    mkdirSync(this.ctx.dir, { recursive: true });
    const body = { manifest: this.ctx.manifest, scannedTo: String(this.scanned), brains: this.all };
    writeFileSync(join(this.ctx.dir, "archive.json"), JSON.stringify(body, null, 1));
  }
}
