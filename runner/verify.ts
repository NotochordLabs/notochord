import { parseAbiItem, type Abi, type Address, type Hex, type PublicClient } from "viem";
import fossilArtifact from "./artifacts/Fossil.json";
import generationArtifact from "./artifacts/Generation.json";
import { protocolHash, type Manifest } from "./deploy";
import { chainHash, closeGeneration, createPopulation, everyone, fitnessOf, HOUR, inputHash, labFor, thoughtBytes, type Lab, type Population } from "./engine";
import { hashJson } from "./replicate";
import type { Drand, MarketSource } from "./sources";
import { thinkOnChain } from "./thought-verifier";

const GENESIS = parseAbiItem("event GenesisRecorded(uint64 drandRound, bytes32 drandRandomness)");
const THOUGHT = parseAbiItem("event Thought(uint32 indexed generation, uint32 indexed hour, bytes32 inputHash, bytes decisions, bytes fired)");
const CLOSED = parseAbiItem("event GenerationClosed(uint32 indexed generation, bytes32 drandRandomness, int32[] selectionFitness, int32[] controlFitness)");
const HOLDOUT = parseAbiItem("event HoldoutRecorded(bytes32 inputHash, int32[] selectionFitness, int32[] controlFitness)");
const REGISTERED = parseAbiItem("event Registered(uint32 indexed id, uint8 population, uint32 born, uint32 parentA, uint32 parentB, bytes32 genomeHash)");

export interface VerifyReport {
  problems: string[];
  checked: { thoughts: number; generations: number; genomes: number; fossils: number; holdouts: number; drand: number; evm: number };
}

/** Public nodes limit log ranges, so a refused request is retried in smaller pieces. */
async function logs(client: PublicClient, address: Address, event: never, from: bigint, to: bigint): Promise<any[]> {
  try {
    return await client.getLogs({ address, event, fromBlock: from, toBlock: to });
  } catch (e) {
    if (to <= from) throw e;
    const mid = (from + to) / 2n;
    return [...(await logs(client, address, event, from, mid)), ...(await logs(client, address, event, mid + 1n, to))];
  }
}

const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => Number(x) === b[i]);
const bytesHex = (b: Uint8Array) => `0x${Buffer.from(b).toString("hex")}`;

/**
 * Rebuilds a run from public inputs alone: the chain's records, the drand beacon
 * and the market's candles. Nothing is read from the runner's own files except the
 * published manifest. Replicates stop at their first mismatch, because everything
 * after it would differ too.
 */
export async function verifyRun(client: PublicClient, manifest: Manifest, realLab: Lab, drand: Drand, source: MarketSource, nowMs: number, log: (s: string) => void = () => {}): Promise<VerifyReport> {
  const r: VerifyReport = { problems: [], checked: { thoughts: 0, generations: 0, genomes: 0, fossils: 0, holdouts: 0, drand: 0, evm: 0 } };
  const { rules, startMs } = manifest;
  const H = rules.hoursPerGeneration;
  const view = await source(nowMs);
  const latest = await client.getBlockNumber();
  const from = BigInt(manifest.deployBlock ?? 0);
  const GEN = generationArtifact.abi as Abi;
  const FOS = fossilArtifact.abi as Abi;
  const local = protocolHash();

  for (const rep of manifest.replicates) {
    const tag = `Tekrar ${rep.index}${rep.wiring ? " (karıştırılmış)" : ""}`;
    const lab = labFor(realLab, manifest.seed, rep);
    const fail = (m: string) => r.problems.push(`${tag}: ${m}`);
    const read = (functionName: string, args: unknown[] = []) => client.readContract({ address: rep.generation, abi: GEN, functionName, args });
    const onChain = (await read("protocolHash")) as Hex;
    if (onChain !== manifest.protocolHash) fail(`protokol özeti manifestle uyuşmuyor (${onChain})`);
    if (onChain !== local) fail(`protokol özeti bu kodla uyuşmuyor: zincir ${onChain}, yerel ${local}`);

    const [genesis] = await logs(client, rep.generation, GENESIS as never, from, latest);
    if (!genesis) continue;
    const beacon = async (round: bigint, value: Hex, what: string) => {
      const real = await drand.get(round, Number.MAX_SAFE_INTEGER);
      r.checked.drand++;
      if (real !== value) fail(`${what}: drand değeri uyuşmuyor (tur ${round})`);
      return real === value;
    };
    if (!(await beacon(genesis.args.drandRound, genesis.args.drandRandomness, "başlangıç"))) continue;

    const registered = new Map<number, Hex>();
    for (const l of await logs(client, rep.specimen, REGISTERED as never, from, latest)) registered.set(Number(l.args.id), l.args.genomeHash);
    const thoughts = new Map<string, any>();
    for (const l of await logs(client, rep.generation, THOUGHT as never, from, latest)) thoughts.set(`${l.args.generation}/${l.args.hour}`, l.args);
    const closed = (await logs(client, rep.generation, CLOSED as never, from, latest)).map((l) => l.args);
    closed.sort((a, b) => a.generation - b.generation);

    const seed = `${manifest.seed}/r${rep.index}`;
    let p: Population | null = createPopulation(lab, seed, genesis.args.drandRandomness, rules);
    let ok = true;
    const checkPopulation = (q: Population) => {
      for (const s of everyone(q)) {
        r.checked.genomes++;
        if (registered.get(s.id) !== chainHash(s)) { fail(`nesil ${q.generation}, örnek ${s.id}: genom özeti uyuşmuyor`); return false; }
      }
      return true;
    };
    const checkFossils = async (q: Population) => {
      const isFossil = (await client.readContract({ address: rep.fossil, abi: FOS, functionName: "isFossilGeneration", args: [q.generation] })) as boolean;
      if (!isFossil) return true;
      for (const s of everyone(q)) {
        const has = (await client.readContract({ address: rep.fossil, abi: FOS, functionName: "recorded", args: [BigInt(q.generation), BigInt(s.id)] })) as boolean;
        if (!has) continue;
        const g = (await client.readContract({ address: rep.fossil, abi: FOS, functionName: "genomeOf", args: [q.generation, s.id] })) as Hex;
        r.checked.fossils++;
        if (g !== bytesHex(s.genome)) { fail(`nesil ${q.generation}, örnek ${s.id}: fosil genomu uyuşmuyor`); return false; }
      }
      return true;
    };

    for (let g = 0; p && ok; g++) {
      ok = checkPopulation(p) && (await checkFossils(p));
      if (!ok) break;
      for (let h = 0; h < H; h++) {
        const t = thoughts.get(`${g}/${h}`);
        if (!t) break;
        const i = view.indexOf(startMs + (g * H + h) * HOUR);
        if (i === null) { fail(`nesil ${g} saat ${h}: mum bulunamadı`); ok = false; break; }
        const b = thoughtBytes(lab, p, view.market, i);
        r.checked.thoughts++;
        if (t.inputHash !== inputHash(view.market, i)) { fail(`nesil ${g} saat ${h}: piyasa girdisi uyuşmuyor`); ok = false; break; }
        if (t.decisions !== bytesHex(b.decisions) || t.fired !== bytesHex(b.fired)) { fail(`nesil ${g} saat ${h}: kararlar uyuşmuyor`); ok = false; break; }
      }
      if (!ok) break;
      // One sampled thought per generation, recomputed by the second implementation on the EVM.
      const sample = thoughts.get(`${g}/${g % H}`);
      if (manifest.verifier && sample && !rep.wiring) {
        const all = everyone(p);
        const k = g % all.length;
        const i = view.indexOf(startMs + (g * H + g % H) * HOUR)!;
        const t = await thinkOnChain(client, manifest.verifier, all[k].genome, view.market.senses[i]);
        const recorded = Buffer.from(sample.decisions.slice(2), "hex")[k];
        const firedRec = Buffer.from(sample.fired.slice(2), "hex")[k];
        r.checked.evm++;
        if ((t.decision === 1 ? 1 : t.decision === -1 ? 2 : 0) !== recorded || t.fired !== firedRec || t.genomeHash !== chainHash(all[k])) {
          fail(`nesil ${g}, örnek ${all[k].id}: EVM beyni kaydı doğrulamadı`);
          ok = false;
          break;
        }
      }
      const c = closed[g];
      if (!c) break;
      const record = (await read("recordOf", [BigInt(g)])) as { drandRound: bigint };
      if (!(await beacon(record.drandRound, c.drandRandomness, `nesil ${g}`))) { ok = false; break; }
      const start = view.indexOf(startMs + g * H * HOUR);
      if (start === null) { fail(`nesil ${g}: mum bulunamadı`); ok = false; break; }
      const next = closeGeneration(lab, p, view.market, start, seed, c.drandRandomness, rules);
      if (!same(c.selectionFitness, next.selectionFitness) || !same(c.controlFitness, next.controlFitness)) { fail(`nesil ${g}: uygunluk uyuşmuyor`); ok = false; break; }
      r.checked.generations++;
      log(`${tag}: nesil ${g} doğrulandı`);
      if (!next.next) {
        const [hold] = await logs(client, rep.generation, HOLDOUT as never, from, latest);
        if (hold) {
          const holdStart = startMs + rules.generations * H * HOUR;
          const i = view.indexOf(holdStart);
          if (i === null) { fail("görülmemiş dönem mumları bulunamadı"); break; }
          const week = view.market.candles.slice(i, i + rules.holdoutHours + 1).map((k) => [k.t, k.c, k.v]);
          r.checked.holdouts++;
          if (hold.args.inputHash !== hashJson(week)) fail("görülmemiş dönem verisi uyuşmuyor");
          else if (!same(hold.args.selectionFitness, fitnessOf(lab, p.selection, view.market, i, rules.holdoutHours)) || !same(hold.args.controlFitness, fitnessOf(lab, p.control, view.market, i, rules.holdoutHours))) fail("görülmemiş dönem uygunluğu uyuşmuyor");
        }
        break;
      }
      p = next.next;
    }
  }
  return r;
}
