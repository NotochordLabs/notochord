import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseCsv, headerKey } from "./csv";
import { Rng } from "./rng";

/**
 * A wiring diagram stored as compressed sparse rows: the outgoing edges of
 * neuron i are edgeDst[rowPtr[i] .. rowPtr[i+1]-1]. Every specimen shares this
 * wiring; only the genome (edge multipliers, thresholds, signs) differs.
 */
export interface Connectome {
  n: number;
  names: string[];
  rowPtr: Int32Array;
  edgeSrc: Int32Array;
  edgeDst: Int32Array;
  /** Integer base weight per edge, derived from synaptic contact depth (µm). */
  edgeBase: Int32Array;
  source: string;
  synthetic: boolean;
}

interface RawEdge {
  s: number;
  t: number;
  w: number;
}

/**
 * Contact depth spans orders of magnitude, so it is compressed with a log:
 * 0.06 µm -> ~16, 1 µm -> ~78, 10 µm -> ~149. The result is an integer so the
 * brain itself never touches floating point.
 */
export function baseWeight(depthUm: number): number {
  return 1 + Math.round(32 * Math.log(1 + Math.max(0, depthUm) / 0.1));
}

export function buildConnectome(
  names: string[],
  rawEdges: RawEdge[],
  source: string,
  synthetic: boolean,
): Connectome {
  const n = names.length;
  // Merge duplicate (s,t) pairs by summing depth.
  const merged = new Map<number, number>();
  for (const e of rawEdges) {
    if (e.s < 0 || e.t < 0 || e.s >= n || e.t >= n) {
      throw new Error(`Edge ${e.s}->${e.t} points outside 0..${n - 1}`);
    }
    const key = e.s * n + e.t;
    merged.set(key, (merged.get(key) ?? 0) + e.w);
  }
  const keys = [...merged.keys()].sort((a, b) => a - b);
  const m = keys.length;
  const edgeSrc = new Int32Array(m);
  const edgeDst = new Int32Array(m);
  const edgeBase = new Int32Array(m);
  const rowPtr = new Int32Array(n + 1);
  keys.forEach((key, i) => {
    const s = Math.floor(key / n);
    const t = key % n;
    edgeSrc[i] = s;
    edgeDst[i] = t;
    edgeBase[i] = baseWeight(merged.get(key)!);
    rowPtr[s + 1]++;
  });
  for (let i = 0; i < n; i++) rowPtr[i + 1] += rowPtr[i];
  return { n, names, rowPtr, edgeSrc, edgeDst, edgeBase, source, synthetic };
}

/** Loads nodes.csv and edges.csv, built from the paper's own matrix (see SOURCE.md). */
export function loadConnectome(dir: string): Connectome {
  const nodesPath = join(dir, "nodes.csv");
  const edgesPath = join(dir, "edges.csv");
  if (!existsSync(nodesPath) || !existsSync(edgesPath)) {
    throw new Error(
      `Wiring not found (${dir}). Run "npm run fetch:connectome" first, or use --synthetic.`,
    );
  }

  const nodeRows = parseCsv(readFileSync(nodesPath, "utf8"));
  const nodeHeader = nodeRows[0].map(headerKey);
  const idxCol = nodeHeader.indexOf("index");
  const nameCol = nodeHeader.indexOf("name");
  const nodes = nodeRows.slice(1).map((r, i) => ({
    index: idxCol >= 0 ? Number(r[idxCol]) : i,
    name: nameCol >= 0 ? r[nameCol].trim() : `cell${i}`,
  }));
  nodes.sort((a, b) => a.index - b.index);
  nodes.forEach((nd, i) => {
    if (nd.index !== i) throw new Error(`nodes.csv indices are not 0..n-1 (got ${nd.index} at ${i})`);
  });
  const names = nodes.map((nd) => nd.name);

  const edgeRows = parseCsv(readFileSync(edgesPath, "utf8"));
  const edgeHeader = edgeRows[0].map(headerKey);
  const sCol = Math.max(0, edgeHeader.indexOf("source"));
  const tCol = edgeHeader.indexOf("target") >= 0 ? edgeHeader.indexOf("target") : 1;
  let wCol = edgeHeader.findIndex((h) => h === "depth" || h === "weight");
  if (wCol < 0) wCol = 2;
  const edges: RawEdge[] = edgeRows.slice(1).map((r) => ({
    s: Number(r[sCol]),
    t: Number(r[tCol]),
    w: Number(r[wCol]),
  }));
  if (edges.some((e) => !Number.isFinite(e.s) || !Number.isFinite(e.t) || !Number.isFinite(e.w))) {
    throw new Error("edges.csv contains non-numeric source/target/weight values");
  }
  return buildConnectome(names, edges, "Ryan, Lu & Meinertzhagen (2016) eLife 5:e16962 Figure 16, source data 1", false);
}

/**
 * A random stand-in with the same size as the real map (216 cells, 3010
 * edges) and clearly named sensory and motor cells. It exists only so the code
 * can be exercised without the real data; results on it mean nothing.
 */
export function syntheticConnectome(seed = "synthetic-connectome"): Connectome {
  const rng = new Rng(seed);
  const n = 216;
  const names: string[] = [];
  for (let i = 1; i <= 3; i++) names.push(`SYN-oto-L${i}`);
  for (let i = 1; i <= 3; i++) names.push(`SYN-oto-R${i}`);
  for (let i = 1; i <= 6; i++) names.push(`SYN-pr-${i}`);
  for (let i = 1; i <= 5; i++) names.push(`SYN-MN-L${i}`);
  for (let i = 1; i <= 5; i++) names.push(`SYN-MN-R${i}`);
  while (names.length < n) names.push(`SYN-n${String(names.length).padStart(3, "0")}`);

  const seen = new Set<number>();
  const edges: RawEdge[] = [];
  while (edges.length < 3010) {
    const s = rng.int(n);
    const t = rng.int(n);
    if (s === t || seen.has(s * n + t)) continue;
    seen.add(s * n + t);
    edges.push({ s, t, w: 0.5 * Math.exp(1.2 * rng.gaussian()) });
  }
  return buildConnectome(names, edges, "SYNTHETIC random graph (not real data)", true);
}
