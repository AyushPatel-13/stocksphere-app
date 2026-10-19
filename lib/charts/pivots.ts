import type { Candle } from "../apis/yahooChart";

/**
 * Classic (floor-trader) pivot points from the previous session's high, low
 * and close — the standard support/resistance levels broker apps show.
 *
 *   P  = (H + L + C) / 3
 *   R1 = 2P − L        S1 = 2P − H
 *   R2 = P + (H − L)   S2 = P − (H − L)
 *   R3 = H + 2(P − L)  S3 = L − 2(H − P)
 */
export type Pivots = {
  pivot: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
};

export function classicPivots(high: number, low: number, close: number): Pivots {
  const pivot = (high + low + close) / 3;
  return {
    pivot,
    r1: 2 * pivot - low,
    r2: pivot + (high - low),
    r3: high + 2 * (pivot - low),
    s1: 2 * pivot - high,
    s2: pivot - (high - low),
    s3: low - 2 * (high - pivot),
  };
}

/**
 * The last completed session among daily candles: the newest candle that
 * started before today's session opened. Null when there isn't one, or it
 * lacks a high or low.
 */
export function previousSession(
  daily: Candle[],
  sessionStart: number | null
): { high: number; low: number; close: number } | null {
  const completed = sessionStart ? daily.filter((candle) => candle.t < sessionStart - 60_000) : daily.slice(0, -1);
  const last = completed.at(-1);
  if (!last || last.h === null || last.l === null) return null;
  return { high: last.h, low: last.l, close: last.c };
}
