/**
 * Turns one simulator run into the single JSON file the site reads. Nothing is
 * computed for show: every number comes from out/<seed>/ and data/.
 *
 *   npx tsx scripts/export-site-data.ts [seed]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { express, Scratch, think } from "../src/brain";
import { loadConnectome } from "../src/connectome";
import { parseCsv } from "../src/csv";
import { layoutFor } from "../src/genome";
import { loadMarket } from "../src/market";
import { detectRoles } from "../src/roles";
import { ALPHA } from "../src/stats";

const seed = process.argv[2] ?? "experiment-177-001";
const root = `out/${seed}`;
const summary = JSON.parse(readFileSync(`${root}/summary.json`, "utf8"));
const results = Array.from({ length: summary.replicates }, (_, k) => JSON.parse(readFileSync(`${root}/r${k + 1}/results.json`, "utf8")));

const c = loadConnectome("data/connectome");
const roles = detectRoles(c);
const layout = layoutFor(c);
const m = loadMarket("data/prices-HYPE-1h.json");

/* ---- brain: drawing position from the dataset, depth from sensory distance ---- */
// Drawing layout only: it plays no part in the experiment. Cells without a layout entry sit at the middle of their neighbours.
const positions = new Map<string, [number, number]>();
for (const row of parseCsv(readFileSync("data/connectome/layout.csv", "utf8")).slice(1)) positions.set(row[0].trim(), [Number(row[1]), Number(row[2])]);
for (const name of c.names.filter((n) => !positions.has(n))) {
  const i = c.names.indexOf(name);
  const near: [number, number][] = [];
  for (let e = 0; e < c.edgeSrc.length; e++) {
    const other = c.edgeSrc[e] === i ? c.edgeDst[e] : c.edgeDst[e] === i ? c.edgeSrc[e] : -1;
    const p = other >= 0 ? positions.get(c.names[other]) : undefined;
    if (p) near.push(p);
  }
  positions.set(name, near.length ? [near.reduce((a, p) => a + p[0], 0) / near.length, near.reduce((a, p) => a + p[1], 0) / near.length] : [0, 0]);
}
const cellMap = new Map<string, { type: string; side: string }>();
{
  const rows = parseCsv(readFileSync("data/connectome/cell-map.csv", "utf8"));
  const col = (k: string) => rows[0].findIndex((h) => h.trim() === k);
  for (const r of rows.slice(1)) if (r[col("status")].trim() === "matched") cellMap.set(r[col("wiring_name")].trim(), { type: r[col("paper_type")].trim(), side: r[col("paper_side")].trim() });
}
const sensory = [...roles.priceUp, ...roles.priceDown, ...roles.volume];
const hops = new Int32Array(c.n).fill(-1);
let frontier = sensory;
frontier.forEach((i) => (hops[i] = 0));
for (let d = 1; frontier.length; d++) {
  const next: number[] = [];
  for (const i of frontier) {
    for (let e = c.rowPtr[i]; e < c.rowPtr[i + 1]; e++) {
      const t = c.edgeDst[e];
      if (hops[t] < 0) {
        hops[t] = d;
        next.push(t);
      }
    }
  }
  frontier = next;
}
const maxHops = Math.max(...hops);
const roleOf = (i: number) =>
  roles.priceUp.includes(i) ? "priceUp" : roles.priceDown.includes(i) ? "priceDown" : roles.volume.includes(i) ? "volume"
    : roles.motorL.includes(i) ? "motorL" : roles.motorR.includes(i) ? "motorR" : "other";
const cells = c.names.map((name, i) => {
  const p = positions.get(name);
  if (!p) throw new Error(`No position for ${name}`);
  const m = cellMap.get(name);
  return { name, x: p[0], y: p[1], z: hops[i] < 0 ? maxHops + 1 : hops[i], role: roleOf(i), paperType: m?.type ?? "", paperSide: m?.side ?? "" };
});
const edges: number[] = [];
for (let e = 0; e < c.edgeSrc.length; e++) edges.push(c.edgeSrc[e], c.edgeDst[e]);

/* ---- three real thoughts of the unseen week's top specimen, tekrar 1 ---- */
const final = JSON.parse(readFileSync(`${root}/r1/fossils/gen-099.json`, "utf8"));
const bestId: number = results[0].holdout.bestSpecimen.id;
const best = final.selection.find((s: { id: number }) => s.id === bestId);
const brain = express(c, layout, Uint8Array.from(Buffer.from(best.genome, "hex")));
const holdFrom = m.candles.findIndex((k) => new Date(k.t).toISOString().slice(0, 16) + "Z" === summary.data.holdoutFrom);
const week = Array.from({ length: 168 }, (_, h) => holdFrom + h);
const byReturn = [...week].sort((a, b) => m.senses[a].r1 - m.senses[b].r1);
const picks = [
  { label: "Sharpest rise", index: byReturn[167] },
  { label: "Sharpest fall", index: byReturn[0] },
  { label: "Quiet hour", index: byReturn[84] },
];
const sc = new Scratch(c.n);
const thoughts = picks.map(({ label, index }) => {
  const frames: number[][] = [];
  const t = think(c, roles, brain, m.senses[index], sc, (spikes) => {
    const on: number[] = [];
    for (let i = 0; i < c.n; i++) if (spikes[i]) on.push(i);
    frames.push(on);
  });
  return { label, time: new Date(m.candles[index].t).toISOString().slice(0, 16), r1: m.senses[index].r1, decision: t.decision, fired: t.fired, motorL: t.motorL, motorR: t.motorR, frames };
});

const weekDecisions = { buy: 0, sell: 0, hold: 0 };
for (const index of week) {
  const d = think(c, roles, brain, m.senses[index], sc).decision;
  weekDecisions[d === 1 ? "buy" : d === -1 ? "sell" : "hold"]++;
}

/* ---- charts ---- */
const replicates = results.map((r, k) => ({
  index: k + 1,
  holdoutSelection: r.holdout.selectionMean,
  holdoutControl: r.holdout.controlMean,
  trainingDiff: r.training.meanDiffBps,
  series: r.generations.map((g: any) => ({
    g: g.generation,
    d: g.windowStart.slice(0, 10),
    s: g.selection.mean,
    k: g.control.mean,
    se: g.selection.exposure,
    ke: g.control.exposure,
  })),
}));

/* ---- lineage of that specimen ---- */
const lineage = new Map<number, any>(results[0].lineage.map((l: any) => [l.id, l]));
const seen = new Map<number, { id: number; born: number; parents: [number, number] | null }>();
const stack = [bestId];
while (stack.length) {
  const id = stack.pop()!;
  if (seen.has(id)) continue;
  const l = lineage.get(id);
  seen.set(id, { id, born: l.born, parents: l.parents });
  if (l.parents) stack.push(...l.parents);
}

/* ---- the plate: each fossil's population, tekrar 1 ---- */
const plates = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 99].map((g) => {
  const f = JSON.parse(readFileSync(`${root}/r1/fossils/gen-${String(g).padStart(3, "0")}.json`, "utf8"));
  const row = (s: { id: number; fitness: number }) => {
    const died = lineage.get(s.id).died;
    return { id: s.id, f: s.fitness, out: died === g };
  };
  return { g, selection: f.selection.map(row), control: f.control.map(row) };
});

/* ---- fossils ---- */
const fossilGens = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 99];
const fossils = fossilGens.map((g) => {
  const f = JSON.parse(readFileSync(`${root}/r1/fossils/gen-${String(g).padStart(3, "0")}.json`, "utf8"));
  const distance = (pop: { genome: string }[]) => {
    const gs = pop.map((s) => Buffer.from(s.genome, "hex"));
    let diff = 0;
    let total = 0;
    for (let a = 0; a < gs.length; a++) {
      for (let b = a + 1; b < gs.length; b++) {
        for (let i = 0; i < gs[a].length; i++) if (gs[a][i] !== gs[b][i]) diff++;
        total += gs[a].length;
      }
    }
    return Math.round((1000 * diff) / total) / 10;
  };
  const top = [...f.selection].sort((a: any, b: any) => b.fitness - a.fitness || a.id - b.id)[0];
  return {
    generation: g,
    date: results[0].generations[g].windowStart.slice(0, 10),
    genomes: f.selection.length + f.control.length,
    selectionDistance: distance(f.selection),
    controlDistance: distance(f.control),
    topId: top.id,
    topHash: top.hash,
  };
});

const out = {
  seed,
  alpha: ALPHA,
  data: summary.data,
  config: summary.config,
  roles: summary.roles,
  tests: {
    training: summary.training,
    vsControl: summary.holdout.vsControl,
    vsFlat: summary.holdout.vsFlat,
    buyHold: summary.holdout.buyHold,
    rejectH0: summary.rejectH0,
  },
  bestSpecimen: results[0].holdout.bestSpecimen,
  brain: { cells, edges, maxHops: maxHops + 1 },
  thoughts,
  weekDecisions,
  replicates,
  lineage: [...seen.values()],
  plates,
  fossils,
};
mkdirSync("site/src/data", { recursive: true });
writeFileSync("site/src/data/experiment.json", JSON.stringify(out));
console.log(
  `OK: ${cells.length} cells, ${edges.length / 2} edges, ancestors ${seen.size}, ` +
    thoughts.map((t) => `${t.label}: r1=${t.r1} karar=${t.decision} ateş=${t.fired}`).join(" | "),
);
