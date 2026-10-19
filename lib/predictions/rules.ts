/**
 * Prediction scoring and badges. Pure functions: the server applies them, the
 * UI explains them, and the tests pin them down. Change a number here and the
 * "How badges work" panel changes with it.
 */

export type Direction = "up" | "down";
export type Horizon = "1d" | "1w" | "1m";
export type PredictionAssetType = "stock" | "index" | "etf" | "crypto";

export const HORIZONS: { id: Horizon; label: string; days: number; points: number }[] = [
  { id: "1d", label: "1 day", days: 1, points: 10 },
  { id: "1w", label: "1 week", days: 7, points: 20 },
  { id: "1m", label: "1 month", days: 30, points: 30 },
];

export function horizonOf(id: string) {
  return HORIZONS.find((h) => h.id === id) ?? null;
}

/** When a prediction made now is checked: the first close on/after this moment. */
export function resolvesAt(createdAt: number, horizon: Horizon): Date {
  return new Date(createdAt + horizonOf(horizon)!.days * 86_400_000);
}

/** Moves smaller than this are a draw (void), not a win or a loss. */
export const FLAT_THRESHOLD_PCT = 0.05;

export type Outcome = { status: "won" | "lost" | "void"; points: number; movePct: number };

/**
 * Score a finished prediction.
 *
 *  - Right direction: the horizon's base points (10 / 20 / 30).
 *  - Plus a target bonus when a target was set: +10 if the close landed
 *    within 1% of it or beyond it, +5 within 3%.
 *  - Wrong direction: 0 points, a loss.
 *  - A move under 0.05% either way: void (doesn't count for or against).
 */
export function scorePrediction(input: {
  direction: Direction;
  horizon: Horizon;
  entry: number;
  exit: number;
  target?: number | null;
}): Outcome {
  const movePct = ((input.exit - input.entry) / input.entry) * 100;

  if (Math.abs(movePct) < FLAT_THRESHOLD_PCT) return { status: "void", points: 0, movePct };

  const wentUp = movePct > 0;
  const right = (input.direction === "up") === wentUp;
  if (!right) return { status: "lost", points: 0, movePct };

  let points = horizonOf(input.horizon)!.points;

  if (input.target) {
    const reached = input.direction === "up" ? input.exit >= input.target : input.exit <= input.target;
    const missPct = (Math.abs(input.exit - input.target) / input.target) * 100;
    if (reached || missPct <= 1) points += 10;
    else if (missPct <= 3) points += 5;
  }

  return { status: "won", points, movePct };
}

/* ------------------------------------------------------------ badges */

export type PredictionStats = { resolved: number; wins: number; points: number };

export type Badge = {
  id: "analyst" | "pro" | "expert" | "master";
  label: string;
  icon: string;
  color: string;
  minResolved: number;
  minAccuracy: number;
};

/**
 * Highest first. A badge needs BOTH enough scored predictions and enough
 * accuracy, so a lucky streak of three doesn't make anyone an expert.
 */
export const BADGES: Badge[] = [
  { id: "master", label: "Market Master", icon: "💎", color: "#38bdf8", minResolved: 100, minAccuracy: 65 },
  { id: "expert", label: "Expert", icon: "🥇", color: "#facc15", minResolved: 50, minAccuracy: 60 },
  { id: "pro", label: "Pro", icon: "🥈", color: "#cbd5e1", minResolved: 25, minAccuracy: 55 },
  { id: "analyst", label: "Analyst", icon: "🥉", color: "#f59e0b", minResolved: 10, minAccuracy: 50 },
];

export function accuracy(stats: PredictionStats): number | null {
  return stats.resolved > 0 ? (stats.wins / stats.resolved) * 100 : null;
}

export function badgeFor(stats: PredictionStats): Badge | null {
  const acc = accuracy(stats);
  if (acc === null) return null;
  return BADGES.find((b) => stats.resolved >= b.minResolved && acc >= b.minAccuracy) ?? null;
}

/** What the next badge up needs, for a progress hint. */
export function nextBadge(stats: PredictionStats): { badge: Badge; needResolved: number; needAccuracy: number } | null {
  const current = badgeFor(stats);
  const ladder = [...BADGES].reverse(); // analyst → master
  const next = current ? ladder[ladder.findIndex((b) => b.id === current.id) + 1] : ladder[0];
  if (!next) return null;
  return {
    badge: next,
    needResolved: Math.max(0, next.minResolved - stats.resolved),
    needAccuracy: next.minAccuracy,
  };
}

/* ------------------------------------------------------------ limits */

export const MAX_NEW_PER_DAY = 10;

/**
 * Validate a new prediction before the entry price is known. The target side
 * is checked again once the entry price is fetched.
 */
export function checkNewPrediction(input: {
  direction: unknown;
  horizon: unknown;
  target: unknown;
  todayCount: number;
  openOnSameCall: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (input.direction !== "up" && input.direction !== "down") return { ok: false, reason: "Pick up or down." };
  if (!horizonOf(String(input.horizon))) return { ok: false, reason: "Pick a time frame." };
  if (input.target !== null && input.target !== undefined && input.target !== "") {
    const value = Number(input.target);
    if (!Number.isFinite(value) || value <= 0) return { ok: false, reason: "The target must be a positive number." };
  }
  if (input.todayCount >= MAX_NEW_PER_DAY) {
    return { ok: false, reason: `You can make up to ${MAX_NEW_PER_DAY} predictions a day.` };
  }
  if (input.openOnSameCall) {
    return { ok: false, reason: "You already have an open prediction on this for that time frame." };
  }
  return { ok: true };
}

export function targetOnRightSide(direction: Direction, entry: number, target: number | null): boolean {
  if (target === null) return true;
  return direction === "up" ? target > entry : target < entry;
}
