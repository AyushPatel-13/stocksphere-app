import type { PredictionStats } from "./rules";

/**
 * Leaderboard ranking. Points alone reward volume (lots of coin-flip calls
 * drift upward), so members are ranked by an accuracy that is pulled toward
 * 50% until they have a real record — a Bayesian average with 5 imaginary
 * wins out of 10 — and only members with enough scored calls are ranked.
 */

export const MIN_RANKED = 20;
const PRIOR_WINS = 5;
const PRIOR_CALLS = 10;

export function adjustedAccuracy(stats: PredictionStats): number {
  return ((stats.wins + PRIOR_WINS) / (stats.resolved + PRIOR_CALLS)) * 100;
}

export type Ranked<T> = T & { rank: number | null; adjustedAccuracy: number };

/**
 * Eligible members first, by adjusted accuracy then points; the rest after
 * them, unranked, by scored calls (closest to qualifying first).
 */
export function rankLeaders<T extends { stats: PredictionStats }>(rows: T[]): Ranked<T>[] {
  const scored = rows.map((row) => ({ ...row, adjustedAccuracy: Math.round(adjustedAccuracy(row.stats) * 10) / 10 }));
  const eligible = scored
    .filter((row) => row.stats.resolved >= MIN_RANKED)
    .sort((a, b) => b.adjustedAccuracy - a.adjustedAccuracy || b.stats.points - a.stats.points || b.stats.resolved - a.stats.resolved);
  const rest = scored
    .filter((row) => row.stats.resolved < MIN_RANKED)
    .sort((a, b) => b.stats.resolved - a.stats.resolved || b.stats.points - a.stats.points);

  return [...eligible.map((row, i) => ({ ...row, rank: i + 1 })), ...rest.map((row) => ({ ...row, rank: null }))];
}
