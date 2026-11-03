/**
 * Compares input scalings on random, unevolved genomes using training hours only.
 * It measures whether input reaches the decision, never fitness, and never reads
 * the unseen week, so it cannot tune the brains to the market.
 *
 *   npx tsx scripts/calibrate-senses.ts [seed]
 */
import { readFileSync } from "node:fs";
import { express, Scratch, think } from "../src/brain";
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
const hours = Array.from({ length: 2400 }, (_, i) => trainStart + i).filter((_, i) => i % 11 === 0);
const genomes: Uint8Array[] = [];
for (let k = 1; k <= 6; k++) {
  const f = JSON.parse(readFileSync(`out/${seed}/r${k}/fossils/gen-000.json`, "utf8"));
  for (const row of f.selection.slice(0, 16)) genomes.push(Uint8Array.from(Buffer.from(row.genome, "hex")));
}
const brains = genomes.map((g) => express(c, layout, g));
const pad = (s: string | number, n: number) => String(s).padStart(n);
console.log(`${brains.length} random brains, ${hours.length} training hours\nprice÷  vol÷ | price reversed flips | volume removed flips | price removed flips | hold % | fixed brains | brains reading price`);
for (const pk of [1, 2, 4, 8]) {
  for (const vk of [1, 4, 16, 64, 1e9]) {
    let total = 0, rev = 0, noVol = 0, noPrice = 0, hold = 0, fixed = 0, reading = 0;
    for (const b of brains) {
      const seen = new Set<number>();
      let flips = 0;
      for (const t of hours) {
        const s = m.senses[t];
        const r1 = Math.trunc(s.r1 / pk), r4 = Math.trunc(s.r4 / pk), dv = Math.trunc(s.dv / vk);
        const d = think(c, roles, b, { r1, r4, dv }, sc).decision;
        const dr = think(c, roles, b, { r1: -r1, r4: -r4, dv }, sc).decision;
        total++;
        seen.add(d);
        if (d === 0) hold++;
        if (dr !== d) { rev++; flips++; }
        if (think(c, roles, b, { r1, r4, dv: 0 }, sc).decision !== d) noVol++;
        if (think(c, roles, b, { r1: 0, r4: 0, dv }, sc).decision !== d) noPrice++;
      }
      if (seen.size === 1) fixed++;
      if (flips / hours.length > 0.1) reading++;
    }
    const p = (a: number, n = total) => `${((100 * a) / n).toFixed(1)}%`;
    console.log(`${pad(pk, 6)} ${pad(vk === 1e9 ? "off" : vk, 5)} | ${pad(p(rev), 20)} | ${pad(p(noVol), 20)} | ${pad(p(noPrice), 19)} | ${pad(p(hold), 6)} | ${pad(p(fixed, brains.length), 12)} | ${pad(p(reading, brains.length), 8)}`);
  }
}
