"use client";

import { useEffect, useState } from "react";
import { loadWiring, replay, type Replay } from "./engine";
import type { Market } from "./store";

/**
 * Everything the site shows as live comes through here, read from the chain and
 * Hyperliquid in this browser. A failed read leaves a field empty; nothing is filled in.
 */
interface Manifest {
  chainId: number;
  startMs: number;
  deployBlock: string;
  rules: { generations: number; hoursPerGeneration: number; holdoutHours: number };
  replicates: { index: number; generation: string; fossil: string; wiring?: string }[];
}
interface Config { deployed?: boolean; rpc: string; chainId: number; simulated: boolean }

export interface RepState { index: number; shuffled: boolean; address: string; phase: number; generation: number; hours: number }
export interface LiveThought { replicate: number; generation: number; hour: number; buy: number; sell: number; hold: number; tx: string; decisions: Uint8Array }
export interface LiveBrain { specimen: number; fossilGeneration: number; generation: number; hour: number; chainDecision: number; run: Replay; candleMs: number; agrees: boolean; r1: number; dv: number }
export interface Feed {
  deployed: boolean;
  failed: boolean;
  manifest: Manifest | null;
  block: number | null;
  reps: RepState[];
  thoughts: LiveThought[];
  /** The most recent hour across the six real-wiring replicates, added together. */
  latest: { generation: number; hour: number; buy: number; sell: number; hold: number; replicates: number } | null;
  brain: LiveBrain | null;
}

const EMPTY: Feed = { deployed: false, failed: false, manifest: null, block: null, reps: [], thoughts: [], latest: null, brain: null };
const HOUR = 3_600_000;
const THOUGHT = "0x95c0e7f744cdc36d102d648a282d8edd370c98acffde513efb3f31b19fc5149a";
/** About 40 blocks a minute: two days of thoughts. */
const LOOKBACK = 120_000;
const SEL = { phase: "0xb1c9fe6e", generation: "0x17219522", hours: "0x3d6ec6bd", selection: "0x15c63984", recorded: "0xd08a65a1", genomeOf: "0xa6647b78" };
const word = (n: number | bigint) => BigInt(n).toString(16).padStart(64, "0");
const hexBytes = (h: string) => Uint8Array.from(h.replace(/^0x/, "").match(/../g) ?? [], (b) => parseInt(b, 16));

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error || j.result === undefined) throw new Error(j.error?.message ?? "no result");
  return j.result;
}
const call = (url: string, to: string, data: string) => rpc<string>(url, "eth_call", [{ to, data }, "latest"]);
const num = (h: string) => Number(BigInt(h));

/** One ABI-encoded dynamic value (bytes or uint[]) from the head slot given. */
function bytesAt(data: string, slot: number) {
  const w = (i: number) => data.slice(2 + i * 64, 2 + (i + 1) * 64);
  const at = Number(BigInt(`0x${w(slot)}`)) / 32;
  const size = Number(BigInt(`0x${w(at)}`));
  return hexBytes(data.slice(2 + (at + 1) * 64, 2 + (at + 1) * 64 + size * 2));
}
function uintsAt(data: string) {
  const w = (i: number) => data.slice(2 + i * 64, 2 + (i + 1) * 64);
  const at = Number(BigInt(`0x${w(0)}`)) / 32;
  const size = Number(BigInt(`0x${w(at)}`));
  return Array.from({ length: size }, (_, i) => Number(BigInt(`0x${w(at + 1 + i)}`)));
}

/** The same senses src/market.ts gives the runner, from the same public candles. */
async function marketAround(candleMs: number): Promise<{ market: Market; index: number } | null> {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req: { coin: "HYPE", interval: "1h", startTime: candleMs - 30 * HOUR, endTime: candleMs + HOUR - 1 } }),
  });
  if (!res.ok) return null;
  const k = ((await res.json()) as { t: number; c: string; v: string }[]).map((x) => ({ t: x.t, c: Number(x.c), v: Number(x.v) }));
  const index = k.findIndex((x) => x.t === candleMs);
  if (index < 24) return null;
  const bps = (x: number) => Math.round(x * 10000);
  const market: Market = { firstTime: k[0].t, holdoutOffset: 0, r1: [], r4: [], dv: [], ret: [], close: k.map((x) => x.c) };
  k.forEach((_, t) => {
    market.ret.push(t + 1 < k.length ? bps(k[t + 1].c / k[t].c - 1) : 0);
    if (t < 24) { market.r1.push(0); market.r4.push(0); market.dv.push(0); return; }
    let sum = 0;
    for (let i = t - 24; i < t; i++) sum += k[i].v;
    const avg = sum / 24;
    market.r1.push(bps(k[t].c / k[t - 1].c - 1));
    market.r4.push(bps(k[t].c / k[t - 4].c - 1));
    market.dv.push(avg > 0 ? Math.max(-100000, Math.min(100000, bps(k[t].v / avg - 1))) : 0);
  });
  return { market, index };
}

/**
 * Full genomes reach the chain only in fossil generations, so this picks a brain
 * alive now that was also fossilized, and recomputes its latest thought here.
 */
async function brainFor(url: string, m: Manifest, t: LiveThought): Promise<LiveBrain | null> {
  const rep = m.replicates[0];
  const fossilGeneration = t.generation - (t.generation % 10);
  const ids = uintsAt(await call(url, rep.generation, SEL.selection));
  let index = -1;
  for (let i = 0; i < ids.length && index < 0; i++) {
    const on = await call(url, rep.fossil, `${SEL.recorded}${word(fossilGeneration)}${word(ids[i])}`);
    if (num(on) === 1) index = i;
  }
  if (index < 0) return null;
  const id = ids[index];
  const genome = bytesAt(await call(url, rep.fossil, `${SEL.genomeOf}${word(fossilGeneration)}${word(id)}`), 0);
  const candleMs = m.startMs + (t.generation * m.rules.hoursPerGeneration + t.hour) * HOUR;
  const around = await marketAround(candleMs);
  if (!around) return null;
  const run = replay(await loadWiring(), genome, around.market, around.index, 1);
  const here = run.thoughts[0].decision;
  const chainDecision = t.decisions[index];
  return { specimen: id, fossilGeneration, generation: t.generation, hour: t.hour, chainDecision, run, candleMs, r1: around.market.r1[around.index], dv: around.market.dv[around.index], agrees: (here === 1 ? 1 : here === -1 ? 2 : 0) === chainDecision };
}

async function read(previous: Feed): Promise<Feed> {
  const c = (await (await fetch("/live/config.json")).json()) as Config;
  if (!c.deployed || c.simulated || c.chainId !== 99901) return EMPTY;
  const m = (await (await fetch("/live/d7f3a9c2.json")).json()) as Manifest;
  const url = c.rpc;
  if (num(await rpc<string>(url, "eth_chainId", [])) !== m.chainId) throw new Error("wrong chain");
  const block = num(await rpc<string>(url, "eth_blockNumber", []));
  const reps: RepState[] = [];
  for (const r of m.replicates) {
    const [phase, generation, hours] = await Promise.all([call(url, r.generation, SEL.phase), call(url, r.generation, SEL.generation), call(url, r.generation, SEL.hours)]);
    reps.push({ index: r.index, shuffled: r.wiring === "shuffled", address: r.generation, phase: num(phase), generation: num(generation), hours: num(hours) });
  }
  const main = m.replicates.filter((r) => !r.wiring);
  const from = Math.max(Number(m.deployBlock), block - LOOKBACK);
  const logs = await rpc<{ address: string; topics: string[]; data: string; transactionHash: string }[]>(url, "eth_getLogs", [{ address: main.map((r) => r.generation), fromBlock: `0x${from.toString(16)}`, toBlock: "latest", topics: [THOUGHT] }]).catch(() => []);
  const thoughts: LiveThought[] = logs.map((l) => {
    const d = bytesAt(l.data, 1);
    const count = (v: number) => d.reduce((n, x) => n + (x === v ? 1 : 0), 0);
    const replicate = main.find((r) => r.generation.toLowerCase() === l.address.toLowerCase())?.index ?? 0;
    return { replicate, generation: num(l.topics[1]), hour: num(l.topics[2]), buy: count(1), sell: count(2), hold: count(0), tx: l.transactionHash, decisions: d };
  }).sort((a, b) => b.generation - a.generation || b.hour - a.hour || a.replicate - b.replicate);
  let latest: Feed["latest"] = null;
  if (thoughts.length) {
    const top = thoughts[0];
    const same = thoughts.filter((t) => t.generation === top.generation && t.hour === top.hour);
    latest = { generation: top.generation, hour: top.hour, replicates: same.length, buy: same.reduce((n, t) => n + t.buy, 0), sell: same.reduce((n, t) => n + t.sell, 0), hold: same.reduce((n, t) => n + t.hold, 0) };
  }
  const first = thoughts.find((t) => t.replicate === 1);
  let brain = previous.brain;
  if (first && (brain?.generation !== first.generation || brain?.hour !== first.hour)) brain = await brainFor(url, m, first).catch(() => previous.brain);
  return { deployed: true, failed: false, manifest: m, block, reps, thoughts, latest, brain };
}

let current: Feed = EMPTY;
let started = false;
const listeners = new Set<(f: Feed) => void>();
const publish = (f: Feed) => { current = f; listeners.forEach((l) => l(f)); };
async function poll() {
  try {
    publish(await read(current));
  } catch {
    const c = await fetch("/live/config.json").then((r) => r.json() as Promise<Config>).catch(() => null);
    publish({ ...current, deployed: !!c?.deployed && !c.simulated, failed: true });
  }
}

export function useLiveFeed() {
  const [feed, setFeed] = useState<Feed>(current);
  useEffect(() => {
    listeners.add(setFeed);
    setFeed(current);
    if (!started) { started = true; void poll(); setInterval(poll, 120_000); }
    return () => { listeners.delete(setFeed); };
  }, []);
  return feed;
}
