import { createHash } from "node:crypto";
export { INHIBITORY_BELOW } from "./brain";
import type { Connectome } from "./connectome";
import { Rng } from "./rng";

/**
 * Genome layout, one byte per gene:
 *   [0, E)          edge multiplier   (weight = base * gene / 128, i.e. 0x to ~2x)
 *   [E, E+N)        firing threshold  (48 + gene * 4)
 *   [E+N, E+2N)     transmitter sign  (gene < 51 -> inhibitory, about 20%)
 * For the real map: 3010 + 216 + 216 bytes, about 3.4 KB per specimen.
 */
export interface Layout {
  edges: number;
  neurons: number;
  size: number;
}

export function layoutFor(c: Connectome): Layout {
  const edges = c.edgeSrc.length;
  return { edges, neurons: c.n, size: edges + 2 * c.n };
}

const clampByte = (x: number) => (x < 0 ? 0 : x > 255 ? 255 : x);

export function randomGenome(layout: Layout, rng: Rng): Uint8Array {
  const g = new Uint8Array(layout.size);
  for (let i = 0; i < layout.edges; i++) g[i] = clampByte(128 + Math.round(24 * rng.gaussian()));
  for (let i = layout.edges; i < layout.size; i++) g[i] = rng.int(256);
  return g;
}

/** Uniform crossover: each gene comes from one parent with equal chance. */
export function crossover(a: Uint8Array, b: Uint8Array, rng: Rng): Uint8Array {
  const child = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) child[i] = rng.u32() & 1 ? a[i] : b[i];
  return child;
}

/** Each gene mutates with probability `rate` by a step in [-16, 16]. */
export function mutate(g: Uint8Array, rng: Rng, rate: number): { genome: Uint8Array; mutations: number } {
  const out = g.slice();
  let mutations = 0;
  for (let i = 0; i < out.length; i++) {
    if (rng.float() < rate) {
      out[i] = clampByte(out[i] + rng.int(33) - 16);
      mutations++;
    }
  }
  return { genome: out, mutations };
}

export function genomeHash(g: Uint8Array): string {
  return createHash("sha256").update(g).digest("hex");
}
