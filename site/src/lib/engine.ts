import { express, Scratch, think, type Brain, type Decision } from "./brain";
import type { Connectome, Layout, Roles } from "./simTypes";
import type { Market } from "./store";

export interface Wiring {
  connectome: Connectome;
  roles: Roles;
  layout: Layout;
  names: string[];
}

const CHUNK = 256;
let wiringPromise: Promise<Wiring> | null = null;
const chunks = new Map<number, Promise<Uint8Array>>();

export function loadWiring() {
  wiringPromise ??= fetch("/archive/connectome.json").then(async (r) => {
    const j = await r.json();
    return {
      connectome: {
        n: j.n,
        rowPtr: Int32Array.from(j.rowPtr),
        edgeSrc: Int32Array.from(j.edgeSrc),
        edgeDst: Int32Array.from(j.edgeDst),
        edgeBase: Int32Array.from(j.edgeBase),
      },
      roles: j.roles,
      layout: j.layout,
      names: j.names,
    };
  });
  return wiringPromise;
}

/** Replicate 1's genome for a specimen, fetched from the archive on demand. */
export async function loadGenome(id: number): Promise<Uint8Array> {
  const { layout } = await loadWiring();
  const n = Math.floor((id - 1) / CHUNK);
  let p = chunks.get(n);
  if (!p) {
    p = fetch(`/archive/genomes/${String(n).padStart(3, "0")}.bin`).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b));
    chunks.set(n, p);
  }
  const buf = await p;
  const at = ((id - 1) % CHUNK) * layout.size;
  return buf.slice(at, at + layout.size);
}

export async function sha256Hex(bytes: Uint8Array) {
  const d = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ThoughtRecord {
  decision: Decision;
  fired: number;
  motorL: number;
  motorR: number;
  frames: number[][];
}

export interface Replay {
  thoughts: ThoughtRecord[];
  pnl: number;
  maxDD: number;
  fitness: number;
  trades: number;
}

const FEE_BPS = 3;

/** Runs the simulator's own engine, in this browser, over a window of real hours. */
export function replay(w: Wiring, genome: Uint8Array, m: Market, start: number, hours: number): Replay {
  const brain: Brain = express(w.connectome as never, w.layout, genome);
  const sc = new Scratch(w.connectome.n);
  const thoughts: ThoughtRecord[] = [];
  let equity = 0, peak = 0, maxDD = 0, prev = 0, trades = 0;
  for (let h = 0; h < hours; h++) {
    const t = start + h;
    const frames: number[][] = [];
    const res = think(w.connectome as never, w.roles, brain, { r1: m.r1[t], r4: m.r4[t], dv: m.dv[t] }, sc, (spikes) => {
      const on: number[] = [];
      for (let i = 0; i < spikes.length; i++) if (spikes[i]) on.push(i);
      frames.push(on);
    });
    thoughts.push({ decision: res.decision, fired: res.fired, motorL: res.motorL, motorR: res.motorR, frames });
    const change = Math.abs(res.decision - prev);
    if (change > 0) trades++;
    equity += res.decision * m.ret[t] - change * FEE_BPS;
    prev = res.decision;
    if (equity > peak) peak = equity;
    if (peak - equity > maxDD) maxDD = peak - equity;
  }
  return { thoughts, pnl: equity, maxDD, fitness: equity - (maxDD >> 1), trades };
}
