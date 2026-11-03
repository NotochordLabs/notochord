/**
 * Power-study replicate on randomised wiring: same market and rules as power-run.ts.
 * Same rules as the experiment; replicates of one market share it, as in the real design.
 *   npx tsx scripts/arm-shuffled.ts <persistPercent> <market> <replicate> <outFile>
 */
import { appendFileSync } from "node:fs";
import { Scratch } from "../src/brain";
import { loadConnectome } from "../src/connectome";
import { genesis, IdCounter, reproduce, survive, type Mode, type Specimen } from "../src/evolution";
import { layoutFor } from "../src/genome";
import { buildMarket, score, type Candle } from "../src/market";
import { Rng } from "../src/rng";
import { detectRoles } from "../src/roles";
import { shuffleConnectome } from "../src/shuffle";
const [pct, mk, rep, out] = process.argv.slice(2);
// z such that P(gaussian < z) = persistence
const Z: Record<string, number> = { "50": 0, "55": 0.12566, "60": 0.25335, "70": 0.5244 };
const c = shuffleConnectome(loadConnectome("data/connectome"), `${pct}/${mk}/${rep}`), layout = layoutFor(c), roles = detectRoles(c);
const G = 100, H = 24, W1 = 168, W4 = 672, WARM = 30;
const rng = new Rng(`power/${pct}/${mk}`);
const candles: Candle[] = [];
let price = 20, last = 1;
for (let h = 0; h < WARM + G * H + W4 + 1; h++) {
  const dir = rng.gaussian() < Z[pct] ? last : -last;
  price *= 1 + (dir * (20 + Math.abs(rng.gaussian()) * 60)) / 10000;
  last = dir;
  candles.push({ t: h * 3600_000, c: price, v: 1e6 * Math.exp(0.5 * rng.gaussian()) });
}
const m = buildMarket(candles, "PLANTED", true), sc = new Scratch(c.n), ids = new IdCounter();
const train = WARM, hold = WARM + G * H;
const tag = `shuffled/${pct}/${mk}/${rep}`;
let sel = genesis(c, layout, tag, 64, "selection", ids);
let ctl: Specimen[] = sel.slice(0, 16).map((s) => ({ ...s, id: ids.take(), population: "control" as const }));
for (let g = 0; g < G - 1; g++) {
  const fit = new Map<number, number>();
  for (const s of [...sel, ...ctl]) fit.set(s.id, score(c, roles, s.brain, m, train + g * H, H, sc).fitness);
  const step = (p: Specimen[], mode: Mode, n: number) => { const r = new Rng(`${tag}/${g}/${mode}`); return reproduce(c, layout, survive(p, fit, mode, r), g + 1, r, 0.01, ids, n); };
  sel = step(sel, "selection", 64); ctl = step(ctl, "control", 16);
}
const avg = (p: Specimen[], w: number) => Math.round(p.reduce((a, s) => a + score(c, roles, s.brain, m, hold, w, sc).fitness, 0) / p.length);
appendFileSync(out, JSON.stringify({ pct: +pct, mk: +mk, rep: +rep, s1: avg(sel, W1), c1: avg(ctl, W1), s4: avg(sel, W4), c4: avg(ctl, W4) }) + "\n");
