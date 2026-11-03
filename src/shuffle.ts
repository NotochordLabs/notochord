import type { Connectome } from "./connectome";
import { Rng } from "./rng";

/**
 * Comparison wiring: the same cells, with each cell's number of inputs and
 * outputs unchanged and the same set of connection weights, but with who connects
 * to whom randomised by edge swaps. Sensory and motor cells keep their names and
 * roles, and the genome size does not change. If the real wiring matters, it should
 * outperform this one. Integers only, deterministic from the seed.
 */
export function shuffleConnectome(c: Connectome, seed: string, swapsPerEdge = 10): Connectome {
  const rng = new Rng(`shuffle/${seed}`);
  const m = c.edgeSrc.length;
  const src = Int32Array.from(c.edgeSrc);
  const dst = Int32Array.from(c.edgeDst);
  const base = Int32Array.from(c.edgeBase);
  const key = (s: number, t: number) => s * c.n + t;
  const present = new Set<number>();
  for (let e = 0; e < m; e++) present.add(key(src[e], dst[e]));
  for (let k = 0; k < swapsPerEdge * m; k++) {
    const a = rng.int(m);
    const b = rng.int(m);
    const [s1, t1, s2, t2] = [src[a], dst[a], src[b], dst[b]];
    if (a === b || s1 === t2 || s2 === t1 || present.has(key(s1, t2)) || present.has(key(s2, t1))) continue;
    present.delete(key(s1, t1));
    present.delete(key(s2, t2));
    present.add(key(s1, t2));
    present.add(key(s2, t1));
    dst[a] = t2;
    dst[b] = t1;
  }
  const order = Array.from({ length: m }, (_, i) => i).sort((x, y) => key(src[x], dst[x]) - key(src[y], dst[y]));
  const edgeSrc = new Int32Array(m);
  const edgeDst = new Int32Array(m);
  const edgeBase = new Int32Array(m);
  const rowPtr = new Int32Array(c.n + 1);
  order.forEach((e, i) => {
    edgeSrc[i] = src[e];
    edgeDst[i] = dst[e];
    edgeBase[i] = base[e];
    rowPtr[src[e] + 1]++;
  });
  for (let i = 0; i < c.n; i++) rowPtr[i + 1] += rowPtr[i];
  return { ...c, rowPtr, edgeSrc, edgeDst, edgeBase, source: `${c.source}, shuffled (${seed})`, synthetic: true };
}
