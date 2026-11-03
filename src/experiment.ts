import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Scratch } from "./brain";
import type { Connectome } from "./connectome";
import { genomeHash, layoutFor } from "./genome";
import { genesis, IdCounter, reproduce, survive, type Mode, type Specimen } from "./evolution";
import { buyHold, score, WARMUP, type Market, type Score } from "./market";
import { detectRoles, type Roles } from "./roles";
import { Rng } from "./rng";
import { mean, median } from "./stats";

export interface Config {
  seed: string;
  generations: number;
  popSize: number;
  controlSize: number;
  mutationRate: number;
  hoursPerGeneration: number;
  holdoutHours: number;
  fossilEvery: number;
  outDir?: string;
}

export const DEFAULTS: Omit<Config, "seed"> = {
  generations: 100,
  popSize: 64,
  controlSize: 16,
  mutationRate: 0.01,
  hoursPerGeneration: 24,
  holdoutHours: 168,
  fossilEvery: 10,
};

export interface PopStats {
  mean: number;
  median: number;
  best: number;
  bestId: number;
  firedMean: number;
  tradesMean: number;
  /** Mean share of hours with an open position (0..1). */
  exposure: number;
}

export interface GenerationRecord {
  generation: number;
  windowStart: string;
  buyHold: number;
  selection: PopStats;
  control: PopStats;
}

export interface Result {
  config: Config;
  data: { connectome: string; market: string; synthetic: boolean; trainFrom: string; holdoutFrom: string; holdoutTo: string };
  roles: { priceUp: string[]; priceDown: string[]; volume: string[]; motorL: string[]; motorR: string[]; method: Roles["method"] };
  generations: GenerationRecord[];
  /** Selection minus control, mean fitness per generation (bps/day). */
  training: { meanDiffBps: number; lastQuarterDiffBps: number };
  holdout: {
    selectionMean: number;
    controlMean: number;
    selectionMedian: number;
    controlMedian: number;
    buyHold: number;
    bestSpecimen: { id: number; fitness: number; pnl: number; maxDD: number };
  };
  lineage: { id: number; population: Mode; born: number; parents: [number, number] | null; died: number | null }[];
}

function popStats(pop: Specimen[], scores: Map<number, Score>): PopStats {
  const f = pop.map((s) => scores.get(s.id)!.fitness);
  let bestId = pop[0].id;
  for (const s of pop) if (scores.get(s.id)!.fitness > scores.get(bestId)!.fitness) bestId = s.id;
  return {
    mean: Math.round(mean(f)),
    median: Math.round(median(f)),
    best: scores.get(bestId)!.fitness,
    bestId,
    firedMean: Math.round(mean(pop.map((s) => scores.get(s.id)!.firedMean)) * 10) / 10,
    tradesMean: Math.round(mean(pop.map((s) => scores.get(s.id)!.trades)) * 10) / 10,
    exposure: Math.round(mean(pop.map((s) => scores.get(s.id)!.exposure)) * 100) / 100,
  };
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";
const hex = (g: Uint8Array) => Buffer.from(g).toString("hex");

export function runExperiment(
  c: Connectome,
  m: Market,
  cfg: Config,
  onGeneration?: (r: GenerationRecord) => void,
): Result {
  const roles = detectRoles(c);
  const layout = layoutFor(c);
  const H = cfg.hoursPerGeneration;
  const L = m.candles.length;

  // Use the most recent data: [train ... | holdout], last return index is L-2.
  const holdoutStart = L - 1 - cfg.holdoutHours;
  const trainStart = holdoutStart - cfg.generations * H;
  if (trainStart < WARMUP) {
    const max = Math.floor((holdoutStart - WARMUP) / H);
    throw new Error(`Veri ${cfg.generations} nesil için yetmiyor; en fazla ${max} nesil çalıştırılabilir (--generations ${max}).`);
  }

  const ids = new IdCounter();
  const born = new Map<number, Specimen>();
  const died = new Map<number, number>();
  // Control starts from the same genesis draw, so both groups begin equal.
  let sel = genesis(c, layout, cfg.seed, cfg.popSize, "selection", ids);
  let ctl: Specimen[] = sel.slice(0, cfg.controlSize).map((s) => ({ ...s, id: ids.take(), population: "control" as const }));
  [...sel, ...ctl].forEach((s) => born.set(s.id, s));

  const sc = new Scratch(c.n);
  const generations: GenerationRecord[] = [];
  const fossilDir = cfg.outDir ? join(cfg.outDir, "fossils") : null;
  if (fossilDir) mkdirSync(fossilDir, { recursive: true });

  const writeFossil = (g: number, scores: Map<number, Score>) => {
    if (!fossilDir) return;
    const dump = (pop: Specimen[]) =>
      pop.map((s) => ({
        id: s.id,
        born: s.born,
        parents: s.parents,
        fitness: scores.get(s.id)!.fitness,
        hash: genomeHash(s.genome),
        genome: hex(s.genome),
      }));
    writeFileSync(
      join(fossilDir, `gen-${String(g).padStart(3, "0")}.json`),
      JSON.stringify({ generation: g, layout, selection: dump(sel), control: dump(ctl) }),
    );
  };

  for (let g = 0; g < cfg.generations; g++) {
    const start = trainStart + g * H;
    const scores = new Map<number, Score>();
    for (const s of [...sel, ...ctl]) scores.set(s.id, score(c, roles, s.brain, m, start, H, sc));

    const rec: GenerationRecord = {
      generation: g,
      windowStart: iso(m.candles[start].t),
      buyHold: buyHold(m, start, H),
      selection: popStats(sel, scores),
      control: popStats(ctl, scores),
    };
    generations.push(rec);
    onGeneration?.(rec);
    if (g % cfg.fossilEvery === 0 || g === cfg.generations - 1) writeFossil(g, scores);

    if (g < cfg.generations - 1) {
      const fit = new Map([...scores].map(([id, s]) => [id, s.fitness]));
      const next = (pop: Specimen[], mode: Mode, size: number) => {
        // Stand-in for the drand round that will seed this generation on chain.
        const rng = new Rng(`${cfg.seed}/gen/${g}/${mode}`);
        const survivors = survive(pop, fit, mode, rng);
        const keep = new Set(survivors.map((s) => s.id));
        pop.forEach((s) => keep.has(s.id) || died.set(s.id, g));
        const out = reproduce(c, layout, survivors, g + 1, rng, cfg.mutationRate, ids, size);
        out.forEach((s) => born.has(s.id) || born.set(s.id, s));
        return out;
      };
      sel = next(sel, "selection", cfg.popSize);
      ctl = next(ctl, "control", cfg.controlSize);
    }
  }

  // Out-of-sample: the final populations on the week they never saw.
  const hold = new Map<number, Score>();
  for (const s of [...sel, ...ctl]) hold.set(s.id, score(c, roles, s.brain, m, holdoutStart, cfg.holdoutHours, sc));
  const hf = (pop: Specimen[]) => pop.map((s) => hold.get(s.id)!.fitness);
  const bestHold = [...sel].sort((a, b) => hold.get(b.id)!.fitness - hold.get(a.id)!.fitness || a.id - b.id)[0];

  const diffs = generations.map((r) => r.selection.mean - r.control.mean);
  const lastQuarter = diffs.slice(Math.floor(diffs.length * 0.75));

  const names = (ids: number[]) => ids.map((i) => c.names[i]);
  return {
    config: cfg,
    data: {
      connectome: c.source,
      market: m.source,
      synthetic: c.synthetic || m.synthetic,
      trainFrom: iso(m.candles[trainStart].t),
      holdoutFrom: iso(m.candles[holdoutStart].t),
      holdoutTo: iso(m.candles[L - 1].t),
    },
    roles: {
      priceUp: names(roles.priceUp),
      priceDown: names(roles.priceDown),
      volume: names(roles.volume),
      motorL: names(roles.motorL),
      motorR: names(roles.motorR),
      method: roles.method,
    },
    generations,
    training: {
      meanDiffBps: Math.round(mean(diffs)),
      lastQuarterDiffBps: Math.round(mean(lastQuarter)),
    },
    holdout: {
      selectionMean: Math.round(mean(hf(sel))),
      controlMean: Math.round(mean(hf(ctl))),
      selectionMedian: Math.round(median(hf(sel))),
      controlMedian: Math.round(median(hf(ctl))),
      buyHold: buyHold(m, holdoutStart, cfg.holdoutHours),
      bestSpecimen: {
        id: bestHold.id,
        fitness: hold.get(bestHold.id)!.fitness,
        pnl: hold.get(bestHold.id)!.pnl,
        maxDD: hold.get(bestHold.id)!.maxDD,
      },
    },
    lineage: [...born.values()]
      .sort((a, b) => a.id - b.id)
      .map((s) => ({ id: s.id, population: s.population, born: s.born, parents: s.parents, died: died.get(s.id) ?? null })),
  };
}
