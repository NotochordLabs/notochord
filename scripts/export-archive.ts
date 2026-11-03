/**
 * Rebuilds the full record of a simulator run for the site: every generation of
 * every replicate, plus replicate 1's genomes. It re-runs the run with the same
 * seeds and stops if the result differs from the saved fossils and summary.
 *
 *   npx tsx scripts/export-archive.ts [seed]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Scratch } from "../src/brain";
import { loadConnectome } from "../src/connectome";
import { genesis, IdCounter, reproduce, survive, type Specimen } from "../src/evolution";
import { DEFAULTS } from "../src/experiment";
import { genomeHash, layoutFor } from "../src/genome";
import { buyHold, loadMarket, score } from "../src/market";
import { detectRoles } from "../src/roles";
import { Rng } from "../src/rng";

const seed = process.argv[2] ?? "experiment-177-001";
const root = `out/${seed}`;
const OUT = "site/public/archive";
const CHUNK = 256;
const summary = JSON.parse(readFileSync(`${root}/summary.json`, "utf8"));

const c = loadConnectome("data/connectome");
const m = loadMarket("data/prices-HYPE-1h.json");
const roles = detectRoles(c);
const layout = layoutFor(c);
const G = DEFAULTS.generations, H = DEFAULTS.hoursPerGeneration, W = DEFAULTS.holdoutHours;
const holdoutStart = m.candles.length - 1 - W;
const trainStart = holdoutStart - G * H;
const sc = new Scratch(c.n);
mkdirSync(`${OUT}/genomes`, { recursive: true });

/* ---- market window, integers as the brains sensed them ---- */
const first = trainStart;
const last = holdoutStart + W;
const range = Array.from({ length: last - first + 1 }, (_, i) => first + i);
writeFileSync(`${OUT}/market.json`, JSON.stringify({
  firstTime: m.candles[first].t,
  trainOffset: 0,
  holdoutOffset: holdoutStart - first,
  r1: range.map((i) => m.senses[i].r1),
  r4: range.map((i) => m.senses[i].r4),
  dv: range.map((i) => m.senses[i].dv),
  ret: range.map((i) => m.ret[i]),
  close: range.map((i) => m.candles[i].c),
}));

/* ---- wiring, in the exact arrays the engine uses ---- */
writeFileSync(`${OUT}/connectome.json`, JSON.stringify({
  n: c.n,
  names: c.names,
  rowPtr: [...c.rowPtr],
  edgeSrc: [...c.edgeSrc],
  edgeDst: [...c.edgeDst],
  edgeBase: [...c.edgeBase],
  roles: { priceUp: roles.priceUp, priceDown: roles.priceDown, volume: roles.volume, motorL: roles.motorL, motorR: roles.motorR },
  layout,
}));

for (let k = 1; k <= summary.replicates; k++) {
  const s = `${seed}/r${k}`;
  const ids = new IdCounter();
  let sel = genesis(c, layout, s, DEFAULTS.popSize, "selection", ids);
  let ctl: Specimen[] = sel.slice(0, DEFAULTS.controlSize).map((x) => ({ ...x, id: ids.take(), population: "control" as const }));
  const all = new Map<number, Specimen>();
  [...sel, ...ctl].forEach((x) => all.set(x.id, x));
  const died = new Map<number, number>();
  const gens: unknown[] = [];

  const row = (pop: Specimen[], start: number, hours: number, into: Map<number, number>) => {
    const scores = pop.map((x) => score(c, roles, x.brain, m, start, hours, sc));
    pop.forEach((x, i) => into.set(x.id, scores[i].fitness));
    return {
      i: pop.map((x) => x.id),
      f: scores.map((r) => r.fitness),
      p: scores.map((r) => r.pnl),
      d: scores.map((r) => r.maxDD),
      t: scores.map((r) => r.trades),
      e: scores.map((r) => Math.round(r.exposure * 100)),
    };
  };

  for (let g = 0; g < G; g++) {
    const start = trainStart + g * H;
    const fit = new Map<number, number>();
    const a = row(sel, start, H, fit);
    const b = row(ctl, start, H, fit);
    const out: number[] = [];
    if (g < G - 1) {
      const next = (pop: Specimen[], mode: "selection" | "control", size: number) => {
        const rng = new Rng(`${s}/gen/${g}/${mode}`);
        const survivors = survive(pop, fit, mode, rng);
        const keep = new Set(survivors.map((x) => x.id));
        pop.forEach((x) => {
          if (!keep.has(x.id)) {
            died.set(x.id, g);
            out.push(x.id);
          }
        });
        const res = reproduce(c, layout, survivors, g + 1, rng, DEFAULTS.mutationRate, ids, size);
        res.forEach((x) => all.set(x.id, x));
        return res;
      };
      gens.push({ t: m.candles[start].t, m: buyHold(m, start, H), s: a, c: b, out });
      const nextSel = next(sel, "selection", DEFAULTS.popSize);
      const nextCtl = next(ctl, "control", DEFAULTS.controlSize);
      sel = nextSel;
      ctl = nextCtl;
    } else {
      gens.push({ t: m.candles[start].t, m: buyHold(m, start, H), s: a, c: b, out });
    }
  }

  // Must equal what the run saved, or the archive is not this experiment.
  const fossil = JSON.parse(readFileSync(`${root}/r${k}/fossils/gen-099.json`, "utf8"));
  const same = (pop: Specimen[], saved: { id: number; hash: string; fitness: number }[]) =>
    pop.every((x, i) => x.id === saved[i].id && genomeHash(x.genome) === saved[i].hash);
  if (!same(sel, fossil.selection) || !same(ctl, fossil.control)) throw new Error(`Replicate ${k} differs from its fossil.`);

  const hold = new Map<number, number>();
  const holdS = row(sel, holdoutStart, W, hold);
  const holdC = row(ctl, holdoutStart, W, hold);
  const mean = (xs: number[]) => Math.round(xs.reduce((u, v) => u + v, 0) / xs.length);
  if (mean(holdS.f) !== summary.holdout.vsFlat.selectionBps[k - 1]) throw new Error(`Replicate ${k} holdout differs from summary.`);

  const specimens = [...all.values()].sort((u, v) => u.id - v.id);
  writeFileSync(`${OUT}/r${k}.json`, JSON.stringify({
    generations: gens,
    holdout: { m: buyHold(m, holdoutStart, W), s: holdS, c: holdC },
    specimens: specimens.map((x) => ({
      id: x.id,
      c: x.population === "control" ? 1 : 0,
      b: x.born,
      p: x.parents,
      x: died.get(x.id) ?? null,
      h: genomeHash(x.genome).slice(0, 16),
    })),
  }));

  if (k === 1) {
    // Genomes in id order, split so a browser fetches only what it opens.
    for (let at = 0, n = 0; at < specimens.length; at += CHUNK, n++) {
      const part = specimens.slice(at, at + CHUNK);
      const buf = new Uint8Array(part.length * layout.size);
      part.forEach((x, i) => buf.set(x.genome, i * layout.size));
      writeFileSync(`${OUT}/genomes/${String(n).padStart(3, "0")}.bin`, buf);
    }
    writeFileSync(`${OUT}/hashes-r1.json`, JSON.stringify(specimens.map((x) => genomeHash(x.genome))));
  }
  console.log(`r${k}: ${specimens.length} specimens OK`);
}

// The browser runs this exact engine, so the copy is regenerated with the data.
const engine = readFileSync("src/brain.ts", "utf8").replace(/from "\.\/(connectome|genome|roles)"/g, 'from "./simTypes"');
writeFileSync("site/src/lib/brain.ts", `// GENERATED from src/brain.ts by scripts/export-archive.ts. Do not edit: the browser runs the simulator's own engine.\n${engine}`);
