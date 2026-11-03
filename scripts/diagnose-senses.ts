/**
 * Does the market reach the brains? Measures, on saved fossils:
 *  - how often sensory drive sits at its cap,
 *  - how often sensory cells fire,
 *  - what happens to decisions if price or volume input is removed.
 * Diagnostic only; it changes nothing in the experiment.
 *
 *   npx tsx scripts/diagnose-senses.ts [seed]
 */
import { readFileSync } from "node:fs";
import { express, Scratch, think, type Decision } from "../src/brain";
import { loadConnectome } from "../src/connectome";
import { DEFAULTS } from "../src/experiment";
import { layoutFor } from "../src/genome";
import { loadMarket } from "../src/market";
import { detectRoles } from "../src/roles";

const seed = process.argv[2] ?? "experiment-177-001";
const c = loadConnectome("data/connectome");
const m = loadMarket("data/prices-HYPE-1h.json");
const roles = detectRoles(c);
const layout = layoutFor(c);
const sc = new Scratch(c.n);
const holdoutStart = m.candles.length - 1 - DEFAULTS.holdoutHours;
const trainStart = holdoutStart - DEFAULTS.generations * DEFAULTS.hoursPerGeneration;
const hours = Array.from({ length: 2400 }, (_, i) => trainStart + i).filter((_, i) => i % 7 === 0); // a spread sample
const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(1)}%`;

// Same formula as think(): integer drive per step, capped at 512.
const pos = (x: number) => (x > 0 ? x : 0);
let upCap = 0, downCap = 0, lightCap = 0, lightZero = 0;
const lights: number[] = [], prices: number[] = [];
for (const t of hours) {
  const s = m.senses[t];
  const up = pos(s.r1) * 8 + pos(s.r4) * 2, down = pos(-s.r1) * 8 + pos(-s.r4) * 2, light = Math.abs(s.dv) >> 3;
  if (up >= 512) upCap++;
  if (down >= 512) downCap++;
  if (light >= 512) lightCap++;
  if (light === 0) lightZero++;
  lights.push(Math.min(light, 512));
  prices.push(Math.min(Math.max(up, down), 512));
}
const q = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length * p)];
console.log(`Input drive over ${hours.length} sampled hours (cap 512 per step):`);
console.log(`  price  median ${q(prices, 0.5)}, p90 ${q(prices, 0.9)}; at cap up ${pct(upCap, hours.length)}, down ${pct(downCap, hours.length)}`);
console.log(`  volume median ${q(lights, 0.5)}, p90 ${q(lights, 0.9)}; at cap ${pct(lightCap, hours.length)}, zero ${pct(lightZero, hours.length)}`);

const summarize = (label: string, gen: string, pop: "selection" | "control") => {
  let total = 0, flipNoPrice = 0, flipNoVolume = 0, flipFlipped = 0, volSpikes = 0, volPossible = 0, priceSpikes = 0, pricePossible = 0, motorSpikes = 0, motorPossible = 0;
  let constantBrains = 0, respondsToPrice = 0, brains = 0;
  const counts: Record<string, number> = { "1": 0, "-1": 0, "0": 0 };
  for (let k = 1; k <= 6; k++) {
    const f = JSON.parse(readFileSync(`out/${seed}/r${k}/fossils/gen-${gen}.json`, "utf8"));
    for (const row of f[pop]) {
      const brain = express(c, layout, Uint8Array.from(Buffer.from(row.genome, "hex")));
      const seen = new Set<Decision>();
      let changed = 0;
      brains++;
      for (const t of hours) {
        const s = m.senses[t];
        let spikes: Uint8Array[] = [];
        const d = think(c, roles, brain, s, sc, (x) => spikes.push(x.slice())).decision;
        for (const sp of spikes) {
          for (const i of roles.volume) volSpikes += sp[i];
          volPossible += roles.volume.length;
          for (const i of [...roles.priceUp, ...roles.priceDown]) priceSpikes += sp[i];
          pricePossible += roles.priceUp.length + roles.priceDown.length;
          for (const i of [...roles.motorL, ...roles.motorR]) motorSpikes += sp[i];
          motorPossible += roles.motorL.length + roles.motorR.length;
        }
        spikes = [];
        const noPrice = think(c, roles, brain, { r1: 0, r4: 0, dv: s.dv }, sc).decision;
        const noVolume = think(c, roles, brain, { r1: s.r1, r4: s.r4, dv: 0 }, sc).decision;
        const flipped = think(c, roles, brain, { r1: -s.r1, r4: -s.r4, dv: s.dv }, sc).decision;
        total++;
        counts[String(d)]++;
        seen.add(d);
        if (noPrice !== d) { flipNoPrice++; changed++; }
        if (noVolume !== d) flipNoVolume++;
        if (flipped !== d) flipFlipped++;
      }
      if (seen.size === 1) constantBrains++;
      if (changed / hours.length > 0.05) respondsToPrice++;
    }
  }
  console.log(`\n${label}, generation ${Number(gen)}, ${pop}, all six replicates (${brains} brains):`);
  console.log(`  decisions: buy ${pct(counts["1"], total)}, sell ${pct(counts["-1"], total)}, hold ${pct(counts["0"], total)}`);
  console.log(`  firing rate per step: volume cells ${pct(volSpikes, volPossible)}, price cells ${pct(priceSpikes, pricePossible)}, motor cells ${pct(motorSpikes, motorPossible)}`);
  console.log(`  decision changes if price input removed ${pct(flipNoPrice, total)}, if price reversed ${pct(flipFlipped, total)}, if volume removed ${pct(flipNoVolume, total)}`);
  console.log(`  brains with one fixed decision all sample ${pct(constantBrains, brains)}; brains where price changes >5% of decisions ${pct(respondsToPrice, brains)}`);
};
summarize("Random genomes", "000", "selection");
summarize("Evolved", "099", "selection");
summarize("Drifted", "099", "control");
