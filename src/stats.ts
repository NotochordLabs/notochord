import { Rng } from "./rng";

/** Protocol threshold, fixed before the next run: one-sided p <= 0.016 (6/6 replicates when n = 6). */
export const ALPHA = 0.016;

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * One-sided sign-flip test: is the mean of the differences > 0?
 * Use it across independent replicates. Specimens inside one population are
 * relatives, not independent samples, so testing across them overstates
 * significance.
 */
export function signFlipTest(diffs: number[], iterations = 100000, seed = "sign-flip") {
  const n = diffs.length;
  const observed = mean(diffs);
  if (n === 0) return { observed, p: 1, exact: true };
  const eps = 1e-9;
  if (n <= 16) {
    // Exact: enumerate every assignment of signs.
    let atLeast = 0;
    const total = 1 << n;
    for (let mask = 0; mask < total; mask++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += mask & (1 << i) ? -diffs[i] : diffs[i];
      if (s / n >= observed - eps) atLeast++;
    }
    return { observed, p: atLeast / total, exact: true };
  }
  const rng = new Rng(seed);
  let atLeast = 0;
  for (let k = 0; k < iterations; k++) {
    let s = 0;
    for (const d of diffs) s += rng.u32() & 1 ? d : -d;
    if (s / n >= observed - eps) atLeast++;
  }
  return { observed, p: (atLeast + 1) / (iterations + 1), exact: false };
}
