/** Real against shuffled wiring on the same artificial markets. Each market is one unit, because replicates of a market share it. */
import { readFileSync } from "node:fs";
const load = (f: string) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const real = load("out/power/results.jsonl"), sh = load("out/arm/shuffled.jsonl");
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
for (const pct of [50, 60, 70]) for (const k of ["s1", "s4"] as const) {
  const rows = [1, 2, 3, 4].map((mk) => {
    const pick = (L: any[]) => L.filter((x) => x.pct === pct && x.mk === mk && x.rep <= 12);
    return [mean(pick(real).map((x) => x[k])), mean(pick(sh).map((x) => x[k]))];
  });
  const r = rows.map(([a, b]) => `${Math.round(a)}/${Math.round(b)}`).join("  ");
  const d = rows.map(([a, b]) => a - b);
  console.log(`persist=${pct}% ${k === "s1" ? "7d" : "28d"} selection fitness real/shuffled by market: ${r} | mean real-shuffled ${Math.round(mean(d))}, markets ahead ${d.filter((x) => x > 0).length}/4`);
}
