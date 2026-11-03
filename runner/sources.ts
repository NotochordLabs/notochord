import { createHash } from "node:crypto";
import { buildMarket, type Candle, type Market } from "../src/market";
import { HOUR } from "./engine";

/** drand "quicknet". `npm run runner:check` compares these with the live network. */
export const DRAND = {
  chainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  genesisTime: 1692803367,
  period: 3,
};

/** First round published at or after `ms`. */
export function roundAt(ms: number): bigint {
  const elapsed = Math.ceil(ms / 1000) - DRAND.genesisTime;
  return BigInt(Math.max(0, Math.ceil(elapsed / DRAND.period)) + 1);
}

export interface Drand {
  /** The round's randomness as 0x hex, or null if it is not available yet. */
  get(round: bigint, nowMs: number): Promise<`0x${string}` | null>;
}

const roundTimeMs = (round: bigint) => (DRAND.genesisTime + (Number(round) - 1) * DRAND.period) * 1000;

/** Replay only: stands in for drand and must never reach a real network. */
export const simulatedDrand: Drand = {
  async get(round, nowMs) {
    if (roundTimeMs(round) > nowMs) return null;
    return `0x${createHash("sha256").update(`SIMULATED-DRAND/${round}`).digest("hex")}`;
  },
};

/**
 * Checks that randomness = sha256(signature). The BLS signature itself is not
 * verified here; anyone can verify it against drand's public key afterwards.
 */
export const liveDrand: Drand = {
  async get(round, nowMs) {
    if (roundTimeMs(round) > nowMs) return null;
    const res = await fetch(`https://api.drand.sh/${DRAND.chainHash}/public/${round}`);
    if (res.status === 404 || res.status === 425) return null;
    if (!res.ok) throw new Error(`drand ${res.status}`);
    const body = (await res.json()) as { randomness: string; signature: string };
    const expected = createHash("sha256").update(Buffer.from(body.signature, "hex")).digest("hex");
    if (expected !== body.randomness) throw new Error(`drand round ${round}: randomness does not match signature`);
    return `0x${body.randomness}`;
  },
};

/** Candles indexed by time. Only candles closed at `nowMs` are ever visible. */
export interface MarketView {
  market: Market;
  /** Index of the candle opening at `ms`, or null if it has not closed yet. */
  indexOf(ms: number): number | null;
}

function makeView(candles: Candle[], source: string, nowMs: number): MarketView {
  const closed = candles.filter((k) => k.t + HOUR <= nowMs).sort((a, b) => a.t - b.t);
  for (let i = 1; i < closed.length; i++) {
    if (closed[i].t - closed[i - 1].t !== HOUR) {
      throw new Error(`Gap in hourly data: ${new Date(closed[i - 1].t).toISOString()}`);
    }
  }
  const t0 = closed.length ? closed[0].t : 0;
  const market = buildMarket(closed, source, false);
  return {
    market,
    indexOf(ms) {
      const i = (ms - t0) / HOUR;
      return Number.isInteger(i) && i >= 0 && i < closed.length ? i : null;
    },
  };
}

export type MarketSource = (nowMs: number) => Promise<MarketView>;

export const replayMarket = (candles: Candle[], source: string): MarketSource => async (nowMs) =>
  makeView(candles, `${source} (replay)`, nowMs);

/** Enough history for the 24h volume average, a full generation and the holdout week. */
const LIVE_LOOKBACK_HOURS = 24 * 12;

export const hyperliquidMarket = (coin: string): MarketSource => async (nowMs) => {
  const endTime = Math.floor(nowMs / HOUR) * HOUR - 1;
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "candleSnapshot",
      req: { coin, interval: "1h", startTime: endTime + 1 - LIVE_LOOKBACK_HOURS * HOUR, endTime },
    }),
  });
  if (!res.ok) throw new Error(`Hyperliquid ${res.status}`);
  const rows = (await res.json()) as { t: number; c: string; v: string }[];
  return makeView(rows.map((k) => ({ t: k.t, c: Number(k.c), v: Number(k.v) })), `Hyperliquid ${coin} 1h`, nowMs);
};
