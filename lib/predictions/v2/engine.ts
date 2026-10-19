import {
  SCORING_V2,
  configFingerprint,
  type CallDirection,
  type Horizon,
  type ScoringConfig,
} from "./config";

/**
 * Prediction resolution and scoring, v2. Pure functions only — no network,
 * no database, no clock. The server supplies the entry price (recorded at
 * submission), the exit price (an official close after expiry) and the band
 * recorded at submission; this module decides the outcome and the points.
 *
 * All distances are percentages of the ENTRY price, so the rules work the same
 * for a ₹50 stock and a ₹5,000 one.
 */

/* ------------------------------------------------------------ helpers */

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Percentage move from entry to exit, rounded for decisions (removes float noise). */
export function movePct(entry: number, exit: number, config: ScoringConfig = SCORING_V2): number {
  return round(((exit - entry) / entry) * 100, config.decisionDecimals);
}

/* ------------------------------------------------------------ band */

/**
 * Sample standard deviation of daily % returns over the given closes (oldest
 * first). Null with fewer than 2 returns or any non-positive close.
 */
export function dailyVolatilityPct(closes: number[]): number | null {
  if (closes.length < 3 || closes.some((c) => !isPositiveNumber(c))) return null;
  const returns = closes.slice(1).map((close, i) => ((close - closes[i]) / closes[i]) * 100);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance);
}

/**
 * The SIDEWAYS / flat band for a call, in %, recorded at submission.
 *
 *   band = clamp(factor × σ_daily × √sessions, floor, ceiling)
 *
 * Without a volatility figure: clamp(defaultBandPctPerK × k, floor, ceiling).
 */
export function movementBandPct(
  horizon: Horizon,
  dailyVolPct: number | null,
  config: ScoringConfig = SCORING_V2
): number {
  const rules = config.horizons[horizon];
  const raw =
    dailyVolPct !== null && Number.isFinite(dailyVolPct) && dailyVolPct >= 0
      ? config.sidewaysVolatilityFactor * dailyVolPct * Math.sqrt(rules.sessions)
      : config.defaultBandPctPerK * rules.k;
  return round(Math.min(rules.bandCeilingPct, Math.max(rules.bandFloorPct, raw)), 4);
}

/* ------------------------------------------------------------ submission check */

export type TargetCheck = { ok: true } | { ok: false; reason: string };

/**
 * A target must sit beyond the band edge on the predicted side (so a correct
 * call can reach it) and within maxTargetPctPerK × k of entry (no extreme
 * targets). SIDEWAYS calls take no target.
 */
export function validateTarget(
  direction: CallDirection,
  horizon: Horizon,
  entry: number,
  target: number | null,
  bandPct: number,
  config: ScoringConfig = SCORING_V2
): TargetCheck {
  if (target === null) return { ok: true };
  if (direction === "sideways") return { ok: false, reason: "SIDEWAYS calls don't take a target." };
  if (!isPositiveNumber(target) || !isPositiveNumber(entry)) return { ok: false, reason: "The target must be a positive price." };

  const distancePct = ((target - entry) / entry) * 100;
  const maxPct = config.maxTargetPctPerK * config.horizons[horizon].k;

  if (direction === "up" && distancePct < bandPct) {
    return { ok: false, reason: `For an UP call the target must be at least ${bandPct}% above the current price.` };
  }
  if (direction === "down" && -distancePct < bandPct) {
    return { ok: false, reason: `For a DOWN call the target must be at least ${bandPct}% below the current price.` };
  }
  if (Math.abs(distancePct) > maxPct) {
    return { ok: false, reason: `Targets can be at most ${maxPct}% from the current price for this time frame.` };
  }
  return { ok: true };
}

/* ------------------------------------------------------------ resolution */

export type DirectionOutcome = "correct" | "incorrect" | "flat";

export type Resolution =
  | {
      outcome: DirectionOutcome;
      movePct: number;
      /** How far the exit landed outside the predicted region, % of entry (0 when correct or flat). */
      regionErrorPct: number;
    }
  | { outcome: "void" | "review"; reason: string; movePct: number | null };

/**
 * Decide a call from entry, exit and the recorded band.
 *
 *   UP        correct m ≥ +b   incorrect m ≤ −b   otherwise flat
 *   DOWN      correct m ≤ −b   incorrect m ≥ +b   otherwise flat
 *   SIDEWAYS  correct |m| < b  incorrect |m| ≥ b
 *
 * Region error (incorrect calls only):
 *   UP        b − m      (distance below the UP region's edge, E·(1+b))
 *   DOWN      m + b      (distance above the DOWN region's edge, E·(1−b))
 *   SIDEWAYS  |m| − b    (distance outside the band)
 */
export function resolveDirection(
  input: { direction: CallDirection; horizon: Horizon; entry: number; exit: number; bandPct: number },
  config: ScoringConfig = SCORING_V2
): Resolution {
  const { direction, horizon, entry, exit, bandPct } = input;

  if (!isPositiveNumber(entry) || !isPositiveNumber(exit)) {
    return { outcome: "void", reason: "invalid-price", movePct: null };
  }
  if (!Number.isFinite(bandPct) || bandPct < 0) {
    return { outcome: "void", reason: "invalid-band", movePct: null };
  }
  if (direction !== "up" && direction !== "down" && direction !== "sideways") {
    return { outcome: "void", reason: "invalid-direction", movePct: null };
  }

  const m = movePct(entry, exit, config);
  const b = round(bandPct, config.decisionDecimals);

  // A move this large over the time frame is far more likely a split, bonus
  // or bad print than a real move: a person reviews it before anything counts.
  if (Math.abs(m) > config.horizons[horizon].maxPlausibleMovePct) {
    return { outcome: "review", reason: "implausible-move", movePct: m };
  }

  const error = (value: number) => round(Math.max(0, value), config.decisionDecimals);

  if (direction === "sideways") {
    return Math.abs(m) < b
      ? { outcome: "correct", movePct: m, regionErrorPct: 0 }
      : { outcome: "incorrect", movePct: m, regionErrorPct: error(Math.abs(m) - b) };
  }

  if (direction === "up") {
    if (m >= b) return { outcome: "correct", movePct: m, regionErrorPct: 0 };
    if (m <= -b) return { outcome: "incorrect", movePct: m, regionErrorPct: error(b - m) };
    return { outcome: "flat", movePct: m, regionErrorPct: 0 };
  }

  if (m <= -b) return { outcome: "correct", movePct: m, regionErrorPct: 0 };
  if (m >= b) return { outcome: "incorrect", movePct: m, regionErrorPct: error(m + b) };
  return { outcome: "flat", movePct: m, regionErrorPct: 0 };
}

/* ------------------------------------------------------------ scoring */

function bandPoints(value: number, bands: { upToPct: number | null; points: number }[]): number {
  const band = bands.find((b) => b.upToPct === null || value <= b.upToPct);
  return band ? band.points : bands[bands.length - 1].points;
}

export type ScoreResult = {
  version: string;
  fingerprint: string;
  outcome: DirectionOutcome | "void" | "review";
  /** Whether this prediction counts toward accuracy, points and reputation. */
  counted: boolean;
  reason: string | null;
  movePct: number | null;
  bandPct: number;
  regionErrorPct: number | null;
  /** Region error ÷ k — what the penalty bands are applied to. */
  normalisedErrorPct: number | null;
  targetErrorPct: number | null;
  targetReached: boolean | null;
  directionPoints: number;
  targetPoints: number;
  totalPoints: number;
};

/**
 * Score one finished prediction.
 *
 * Total = direction points + target points, kept separate so no mistake is
 * counted twice:
 *   correct    +base
 *   incorrect  −min(band(regionError ÷ k) × base ÷ 10, cap × base); target ignored
 *   flat       0, not counted
 *   void/review 0, not counted
 * Target points (correct UP/DOWN with a target only), on |exit − target| ÷ entry ÷ k:
 *   reached or ≤1% +10 · ≤3% +5 · ≤5% 0 · over 5% −5
 */
export function scorePredictionV2(
  input: {
    direction: CallDirection;
    horizon: Horizon;
    entry: number;
    exit: number;
    bandPct: number;
    target?: number | null;
  },
  config: ScoringConfig = SCORING_V2
): ScoreResult {
  const rules = config.horizons[input.horizon];
  const target = input.target ?? null;
  const base: Omit<ScoreResult, "outcome" | "counted" | "reason" | "movePct"> = {
    version: config.version,
    fingerprint: configFingerprint(config),
    bandPct: input.bandPct,
    regionErrorPct: null,
    normalisedErrorPct: null,
    targetErrorPct: null,
    targetReached: null,
    directionPoints: 0,
    targetPoints: 0,
    totalPoints: 0,
  };

  if (!rules) {
    return { ...base, outcome: "void", counted: false, reason: "invalid-horizon", movePct: null };
  }

  if (target !== null && (input.direction === "sideways" || !isPositiveNumber(target))) {
    return { ...base, outcome: "void", counted: false, reason: "invalid-target", movePct: null };
  }

  const resolution = resolveDirection(input, config);

  if (resolution.outcome === "void" || resolution.outcome === "review") {
    return { ...base, outcome: resolution.outcome, counted: false, reason: resolution.reason, movePct: resolution.movePct };
  }

  if (resolution.outcome === "flat") {
    return { ...base, outcome: "flat", counted: false, reason: "inside-band", movePct: resolution.movePct, regionErrorPct: 0 };
  }

  if (resolution.outcome === "incorrect") {
    const normalised = round(resolution.regionErrorPct / rules.k, config.decisionDecimals);
    const raw = bandPoints(normalised, config.penaltyBands) * (rules.base / config.penaltyScaleDivisor);
    const penalty = Math.min(raw, config.penaltyCapMultiplier * rules.base);
    return {
      ...base,
      outcome: "incorrect",
      counted: true,
      reason: null,
      movePct: resolution.movePct,
      regionErrorPct: resolution.regionErrorPct,
      normalisedErrorPct: normalised,
      directionPoints: -penalty,
      totalPoints: -penalty,
    };
  }

  // Correct.
  let targetPoints = 0;
  let targetErrorPct: number | null = null;
  let targetReached: boolean | null = null;

  if (target !== null) {
    targetReached = input.direction === "up" ? input.exit >= target : input.exit <= target;
    targetErrorPct = round(((Math.abs(input.exit - target) / input.entry) * 100) / rules.k, config.decisionDecimals);
    targetPoints = targetReached
      ? config.targetBands[0].points
      : bandPoints(targetErrorPct, config.targetBands);
  }

  return {
    ...base,
    outcome: "correct",
    counted: true,
    reason: null,
    movePct: resolution.movePct,
    regionErrorPct: 0,
    normalisedErrorPct: 0,
    targetErrorPct,
    targetReached,
    directionPoints: rules.base,
    targetPoints,
    totalPoints: rules.base + targetPoints,
  };
}
