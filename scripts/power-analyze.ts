/** Power table from power-run results. Exact one-sided sign-flip test; a market passes only if selection beats both control and flat. */
import { readFileSync } from "node:fs";
const L = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const ALPHA = 0.016;
function p(d: number[]) { const n = d.length, o = d.reduce((a, b) => a + b, 0), a = d.map(Math.abs); let hit = 0, tot = 0; for (let m = 0; m < 1 << n; m++) { let s = 0; for (let i = 0; i < n; i++) s += m >> i & 1 ? -a[i] : a[i]; tot++; if (s >= o) hit++; } return hit / tot; }
const wilson = (k: number, n: number) => { const z = 1.96, ph = k / n, d = 1 + z * z / n, c = ph + z * z / (2 * n), h = z * Math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)); return `${Math.round(100 * (c - h) / d)}-${Math.round(100 * (c + h) / d)}%`; };
for (const [w, s, cc] of [["7d", "s1", "c1"], ["28d", "s4", "c4"]] as const) for (const pct of [50, 55, 60, 70]) for (const N of [6, 12, 18]) {
  const mk = [...new Set(L.filter((x) => x.pct === pct).map((x) => x.mk))]; let pass = 0, done = 0, wins = 0, cnt = 0;
  for (const k of mk) { const r = L.filter((x) => x.pct === pct && x.mk === k && x.rep <= N); if (r.length < N) continue; done++;
    const a = p(r.map((x) => x[s] - x[cc])), b = p(r.map((x) => x[s])); if (a <= ALPHA && b <= ALPHA) pass++;
    wins += r.filter((x) => x[s] > x[cc]).length; cnt += N; }
  if (done) console.log(`${w} persist=${pct}% N=${N}: passed ${pass}/${done} (95% CI ${wilson(pass, done)}), rep beats control ${(100 * wins / cnt).toFixed(0)}%`);
}
