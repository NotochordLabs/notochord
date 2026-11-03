// GENERATED from src/brain.ts by scripts/export-archive.ts. Do not edit: the browser runs the simulator's own engine.
import type { Connectome } from "./simTypes";
import type { Layout } from "./simTypes";
import type { Roles } from "./simTypes";

/** A sign gene below this value makes a cell inhibitory (about 20% of random genes). */
export const INHIBITORY_BELOW = 51;

/** Number of discrete steps the network runs per thought. */
export const STEPS = 32;
/** Leak: each step a neuron keeps 3/4 of its potential (v -= v >> 2). */
const LEAK_SHIFT = 2;
/** Floor for the membrane potential, so inhibition cannot pile up forever. */
const V_MIN = -1024;
/** Cap on sensory drive per step. */
const DRIVE_MAX = 512;
/** Motor spike difference needed before the brain commits to a side. */
const MARGIN = 2;

/** A genome expressed onto the shared wiring. Integers only. */
export interface Brain {
  eff: Int32Array;
  thr: Int32Array;
}

export function express(c: Connectome, layout: Layout, g: Uint8Array): Brain {
  const E = layout.edges;
  const N = layout.neurons;
  const eff = new Int32Array(E);
  for (let e = 0; e < E; e++) {
    const sign = g[E + N + c.edgeSrc[e]] < INHIBITORY_BELOW ? -1 : 1;
    eff[e] = sign * ((c.edgeBase[e] * g[e]) >> 7);
  }
  const thr = new Int32Array(N);
  for (let i = 0; i < N; i++) thr[i] = 48 + g[E + i] * 4;
  return { eff, thr };
}

/** Market input for one thought, in basis points. */
export interface Senses {
  r1: number; // last hour return
  r4: number; // last four hours return
  dv: number; // volume vs trailing 24h average
}

export type Decision = -1 | 0 | 1;

export interface Thought {
  decision: Decision;
  fired: number; // distinct cells that fired at least once
  motorL: number;
  motorR: number;
}

/** Reusable buffers so a thought allocates nothing. */
export class Scratch {
  v: Int32Array;
  cur: Int32Array;
  spk: Uint8Array;
  next: Uint8Array;
  ever: Uint8Array;
  constructor(n: number) {
    this.v = new Int32Array(n);
    this.cur = new Int32Array(n);
    this.spk = new Uint8Array(n);
    this.next = new Uint8Array(n);
    this.ever = new Uint8Array(n);
  }
}

const pos = (x: number) => (x > 0 ? x : 0);
const cap = (x: number) => (x > DRIVE_MAX ? DRIVE_MAX : x);

/**
 * One thought: reset, then run the leaky integrate-and-fire network for STEPS
 * steps with constant sensory drive, counting left and right motor spikes.
 * Deterministic: integer arithmetic only, fixed iteration order.
 */
export function think(
  c: Connectome,
  roles: Roles,
  brain: Brain,
  s: Senses,
  sc: Scratch,
  /** Optional observer of each step's spikes; never changes the result. */
  onStep?: (spikes: Uint8Array) => void,
): Thought {
  const n = c.n;
  const { v, cur, ever } = sc;
  let spk = sc.spk;
  let next = sc.next;
  v.fill(0);
  spk.fill(0);
  ever.fill(0);

  const up = cap(pos(s.r1) * 8 + pos(s.r4) * 2);
  const down = cap(pos(-s.r1) * 8 + pos(-s.r4) * 2);
  const light = cap(Math.abs(s.dv) >> 3);

  let motorL = 0;
  let motorR = 0;
  const { rowPtr, edgeDst } = c;
  const { eff, thr } = brain;

  for (let step = 0; step < STEPS; step++) {
    cur.fill(0);
    for (let i = 0; i < n; i++) {
      if (!spk[i]) continue;
      for (let e = rowPtr[i]; e < rowPtr[i + 1]; e++) cur[edgeDst[e]] += eff[e];
    }
    for (const i of roles.priceUp) cur[i] += up;
    for (const i of roles.priceDown) cur[i] += down;
    for (const i of roles.volume) cur[i] += light;

    for (let i = 0; i < n; i++) {
      let x = v[i] - (v[i] >> LEAK_SHIFT) + cur[i];
      if (x < V_MIN) x = V_MIN;
      if (x >= thr[i]) {
        next[i] = 1;
        ever[i] = 1;
        x = 0;
      } else next[i] = 0;
      v[i] = x;
    }
    for (const i of roles.motorL) motorL += next[i];
    for (const i of roles.motorR) motorR += next[i];
    onStep?.(next);
    const tmp = spk;
    spk = next;
    next = tmp;
  }

  let fired = 0;
  for (let i = 0; i < n; i++) fired += ever[i];
  const diff = motorR - motorL;
  const decision: Decision = diff > MARGIN ? 1 : diff < -MARGIN ? -1 : 0;
  return { decision, fired, motorL, motorR };
}
