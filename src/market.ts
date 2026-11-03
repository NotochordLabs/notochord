import { readFileSync, existsSync } from "node:fs";
import type { Brain, Senses, Scratch } from "./brain";
import { think } from "./brain";
import type { Connectome } from "./connectome";
import type { Roles } from "./roles";
import { Rng } from "./rng";

export interface Candle {
  t: number; // open time, ms
  c: number; // close
  v: number; // volume
}

/** Hourly market prepared as integers (basis points). */
export interface Market {
  candles: Candle[];
  /** ret[t]: return from close t to close t+1, in bps. */
  ret: Int32Array;
  senses: Senses[];
  source: string;
  synthetic: boolean;
}

/** Hours of history needed before the first thought (for the 24h volume average). */
export const WARMUP = 24;
/** Taker fee charged per unit of position change, in bps. */
export const FEE_BPS = 3;

const bps = (x: number) => Math.round(x * 10000);

export function buildMarket(candles: Candle[], source: string, synthetic: boolean): Market {
  const L = candles.length;
  const ret = new Int32Array(L);
  for (let t = 0; t + 1 < L; t++) ret[t] = bps(candles[t + 1].c / candles[t].c - 1);
  const senses: Senses[] = candles.map((_, t) => {
    if (t < WARMUP) return { r1: 0, r4: 0, dv: 0 };
    let sum = 0;
    for (let k = t - WARMUP; k < t; k++) sum += candles[k].v;
    const avg = sum / WARMUP;
    return {
      r1: bps(candles[t].c / candles[t - 1].c - 1),
      r4: bps(candles[t].c / candles[t - 4].c - 1),
      dv: avg > 0 ? Math.max(-100000, Math.min(100000, bps(candles[t].v / avg - 1))) : 0,
    };
  });
  return { candles, ret, senses, source, synthetic };
}

export function loadMarket(path: string): Market {
  if (!existsSync(path)) {
    throw new Error(`Fiyat verisi bulunamadı (${path}). Önce "npm run fetch:prices" çalıştır ya da --synthetic kullan.`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as { coin: string; interval: string; candles: Candle[] };
  const candles = raw.candles.slice().sort((a, b) => a.t - b.t);
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].t - candles[i - 1].t !== 3600_000) {
      console.warn(`Uyarı: ${new Date(candles[i - 1].t).toISOString()} sonrasında saatlik veride boşluk var.`);
      break;
    }
  }
  return buildMarket(candles, `Hyperliquid ${raw.coin} ${raw.interval}`, false);
}

/** Geometric random walk: no pattern exists to be learned. For code checks only. */
export function syntheticMarket(hours: number, seed = "synthetic-market"): Market {
  const rng = new Rng(seed);
  const candles: Candle[] = [];
  let price = 20;
  const t0 = Date.UTC(2026, 0, 1);
  for (let h = 0; h < hours; h++) {
    price *= Math.exp(0.01 * rng.gaussian());
    candles.push({ t: t0 + h * 3600_000, c: price, v: 1e6 * Math.exp(0.5 * rng.gaussian()) });
  }
  return buildMarket(candles, "SYNTHETIC random walk (not real data)", true);
}

export interface Score {
  pnl: number; // bps, after fees
  maxDD: number; // bps
  fitness: number; // pnl - maxDD / 2
  trades: number;
  exposure: number;
  firedMean: number;
}

/**
 * Paper-trades one brain over [start, start + hours). The decision taken at
 * hour t is held over the return from t to t+1. Fitness rewards return and
 * penalises the deepest drawdown, so steady beats lucky.
 */
export function score(
  c: Connectome,
  roles: Roles,
  brain: Brain,
  m: Market,
  start: number,
  hours: number,
  sc: Scratch,
  decisions?: Int8Array,
): Score {
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  let prev = 0;
  let trades = 0;
  let firedSum = 0;
  let open = 0;
  for (let h = 0; h < hours; h++) {
    const t = start + h;
    const th = think(c, roles, brain, m.senses[t], sc);
    const d = th.decision;
    if (decisions) decisions[h] = d;
    firedSum += th.fired;
    const change = Math.abs(d - prev);
    trades += change > 0 ? 1 : 0;
    equity += d * m.ret[t] - change * FEE_BPS;
    prev = d;
    if (d !== 0) open++;
    if (equity > peak) peak = equity;
    if (peak - equity > maxDD) maxDD = peak - equity;
  }
  return { pnl: equity, maxDD, fitness: equity - (maxDD >> 1), trades, exposure: open / hours, firedMean: firedSum / hours };
}

/** Buy-and-hold over the same window, for context. */
export function buyHold(m: Market, start: number, hours: number): number {
  let s = 0;
  for (let h = 0; h < hours; h++) s += m.ret[start + h];
  return s;
}
