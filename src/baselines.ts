import { FEE_BPS, type Market, type Score } from "./market";
import { Rng } from "./rng";

/** Scores a fixed rule exactly as a brain is scored: same fee, same fitness. */
function scoreRule(m: Market, start: number, hours: number, rule: (t: number) => number): Score {
  let equity = 0, peak = 0, maxDD = 0, prev = 0, trades = 0, open = 0;
  for (let h = 0; h < hours; h++) {
    const t = start + h;
    const d = rule(t);
    const change = Math.abs(d - prev);
    trades += change > 0 ? 1 : 0;
    equity += d * m.ret[t] - change * FEE_BPS;
    prev = d;
    if (d !== 0) open++;
    if (equity > peak) peak = equity;
    if (peak - equity > maxDD) maxDD = peak - equity;
  }
  return { pnl: equity, maxDD, fitness: equity - (maxDD >> 1), trades, exposure: open / hours, firedMean: 0 };
}

/** Follows the last hour's direction. Needs no brain and no learning. */
export const momentumRule = (m: Market, start: number, hours: number) =>
  scoreRule(m, start, hours, (t) => Math.sign(m.senses[t].r1));

/** Holds the same position as long as the market stays; the plainest possible benchmark. */
export const longOnly = (m: Market, start: number, hours: number) => scoreRule(m, start, hours, () => 1);

/** Average fitness of many brainless coin-flip traders: buy, sell or hold with equal chance. */
export function randomRule(m: Market, start: number, hours: number, seed: string, runs = 64): number {
  let total = 0;
  for (let k = 0; k < runs; k++) {
    const rng = new Rng(`baseline/${seed}/${k}`);
    total += scoreRule(m, start, hours, () => rng.int(3) - 1).fitness;
  }
  return Math.round(total / runs);
}
