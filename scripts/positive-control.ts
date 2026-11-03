/**
 * Positive control: if a real, simple pattern is planted in an artificial market,
 * can selection on this wiring find it? No real market data is read.
 *   npx tsx scripts/positive-control.ts <current|swapped> <momentum|walk> <replicate>
 */
import { Scratch, think } from "../src/brain";
import { loadConnectome } from "../src/connectome";
import { genesis, IdCounter, reproduce, survive, type Mode, type Specimen } from "../src/evolution";
import { layoutFor } from "../src/genome";
import { buildMarket, score, type Candle } from "../src/market";
import { Rng } from "../src/rng";
import { detectRoles } from "../src/roles";
const [wiring, kind, rep] = process.argv.slice(2);
const c = loadConnectome("data/connectome"), layout = layoutFor(c), base = detectRoles(c);
const roles = wiring === "swapped"
  ? { ...base, priceUp: base.volume.filter((_, i) => i % 2 === 0), priceDown: base.volume.filter((_, i) => i % 2 === 1), volume: [...base.priceUp, ...base.priceDown] }
  : base;
const rng = new Rng(`pc/${kind}/${rep}`);
const candles: Candle[] = [];
let price = 20, last = 1;
for (let h = 0; h < 2700; h++) {
  // momentum: the sign of the next move repeats the last one 70% of the time. Size is independent noise.
  const dir = kind === "momentum" ? (rng.gaussian() < 0.5244 ? last : -last) : rng.gaussian() < 0 ? -1 : 1;
  price *= 1 + (dir * (20 + Math.abs(rng.gaussian()) * 60)) / 10000;
  last = dir;
  candles.push({ t: h * 3600_000, c: price, v: 1e6 * Math.exp(0.5 * rng.gaussian()) });
}
const m = buildMarket(candles, "PLANTED", true), sc = new Scratch(c.n), ids = new IdCounter();
const G = 100, H = 24, hold = candles.length - 169, train = hold - G * H;
let sel = genesis(c, layout, `pc/${rep}`, 64, "selection", ids);
let ctl: Specimen[] = sel.slice(0, 16).map((s) => ({ ...s, id: ids.take(), population: "control" as const }));
for (let g = 0; g < G - 1; g++) {
  const fit = new Map<number, number>();
  for (const s of [...sel, ...ctl]) fit.set(s.id, score(c, roles, s.brain, m, train + g * H, H, sc).fitness);
  const step = (p: Specimen[], mode: Mode, n: number) => { const r = new Rng(`pc/${rep}/${g}/${mode}`); return reproduce(c, layout, survive(p, fit, mode, r), g + 1, r, 0.01, ids, n); };
  sel = step(sel, "selection", 64); ctl = step(ctl, "control", 16);
}
const avg = (p: Specimen[]) => p.reduce((a, s) => a + score(c, roles, s.brain, m, hold, 168, sc).pnl, 0) / p.length;
const flips = (p: Specimen[]) => { let n = 0, f = 0; for (const s of p) for (let t = hold; t < hold + 168; t += 3) { const a = m.senses[t]; n++; if (think(c, roles, s.brain, a, sc).decision !== think(c, roles, s.brain, { r1: -a.r1, r4: -a.r4, dv: a.dv }, sc).decision) f++; } return (100 * f) / n; };
console.log(JSON.stringify({ wiring, kind, rep, sel: Math.round(avg(sel)), ctl: Math.round(avg(ctl)), selFlip: +flips(sel).toFixed(1), ctlFlip: +flips(ctl).toFixed(1) }));
