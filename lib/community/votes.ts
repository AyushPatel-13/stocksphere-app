/**
 * Up/down votes, as pure rules so the card's optimistic update and its
 * rollback are unit-tested. One vote per member per post or comment
 * (post_votes' primary key): clicking your current vote removes it,
 * clicking the other one switches it. Safe in the browser.
 */

export type Vote = -1 | 0 | 1;
export type VoteCounts = { up: number; down: number };

/** The vote after clicking `clicked` (▲ = 1, ▼ = -1) when the current one is `current`. */
export function nextVote(current: Vote, clicked: 1 | -1): Vote {
  return current === clicked ? 0 : clicked;
}

/** Counts after a vote changes from `from` to `to` (never below zero). */
export function applyVote(counts: VoteCounts, from: Vote, to: Vote): VoteCounts {
  const up = counts.up - (from === 1 ? 1 : 0) + (to === 1 ? 1 : 0);
  const down = counts.down - (from === -1 ? 1 : 0) + (to === -1 ? 1 : 0);
  return { up: Math.max(0, up), down: Math.max(0, down) };
}

export function scoreOf(counts: VoteCounts): number {
  return counts.up - counts.down;
}

/** "1.2k", "-3", "0": a compact score. */
export function formatScore(score: number): string {
  const abs = Math.abs(score);
  if (abs < 1000) return String(score);
  const short = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(1)}M` : `${(abs / 1000).toFixed(1)}k`;
  return `${score < 0 ? "-" : ""}${short.replace(".0", "")}`;
}
