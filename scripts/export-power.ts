/** Writes the site's power table from the study's raw results. Artificial markets only. */
import { readFileSync, writeFileSync } from "node:fs";
const load = (f: string) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const L = load("out/power/results.jsonl"), S = load("out/arm/shuffled.jsonl");
const ALPHA = 0.016;
function p(d: number[]) { const n = d.length, o = d.reduce((a, b) => a + b, 0), a = d.map(Math.abs); let hit = 0; for (let m = 0; m < 1 << n; m++) { let s = 0; for (let i = 0; i < n; i++) s += m >> i & 1 ? -a[i] : a[i]; if (s >= o) hit++; } return hit / (1 << n); }
const passed = (pct: number, N: number, s: "s1" | "s4", c: "c1" | "c4") => {
  let k = 0;
  for (let mk = 1; mk <= 8; mk++) { const r = L.filter((x) => x.pct === pct && x.mk === mk && x.rep <= N); if (p(r.map((x) => x[s] - x[c])) <= ALPHA && p(r.map((x) => x[s])) <= ALPHA) k++; }
  return k;
};
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const arm = [50, 60, 70].map((pct) => {
  const d = [1, 2, 3, 4].map((mk) => mean(L.filter((x) => x.pct === pct && x.mk === mk && x.rep <= 12).map((x) => x.s4)) - mean(S.filter((x) => x.pct === pct && x.mk === mk).map((x) => x.s4)));
  return { pct, realMinusShuffled: Math.round(mean(d)), marketsAhead: d.filter((x) => x > 0).length };
});
writeFileSync("site/src/data/power.json", JSON.stringify({ markets: 8, rows: [50, 55, 60, 70].map((pct) => ({ pct, six: passed(pct, 6, "s1", "c1"), twelve: passed(pct, 12, "s1", "c1"), eighteen: passed(pct, 18, "s1", "c1"), six28: passed(pct, 6, "s4", "c4"), eighteen28: passed(pct, 18, "s4", "c4") })), arm }, null, 1));
