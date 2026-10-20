/**
 * Prediction scoring v2 — the one place every number lives.
 *
 * Pure data. Change a value and you must change `version`: every stored
 * result records the version and fingerprint it was scored with, so old
 * results stay explainable after the rules move on.
 *
 * Submission (Phase 1b) reads the band and `submission` rules; scoring is
 * wired in Phase 2.
 */

export type Horizon = "1d" | "1w" | "1m";
export type CallDirection = "up" | "down" | "sideways";

export type HorizonRules = {
  /** Points for a correct direction call. */
  base: number;
  /**
   * Time-frame scale: distances are divided by this so a 4% move over a month
   * weighs like a 1% move over a day (roughly √time).
   */
  k: number;
  /** Trading sessions until expiry (crypto uses `cryptoHours`). */
  sessions: number;
  cryptoHours: number;
  /** SIDEWAYS/flat band limits, in %. */
  bandFloorPct: number;
  bandCeilingPct: number;
  /** A move larger than this in one call is sent to review (likely a split). */
  maxPlausibleMovePct: number;
};

export type PenaltyBand = {
  /** Upper bound of normalised error, inclusive; null = no upper bound. */
  upToPct: number | null;
  points: number;
};

export type TargetBand = {
  upToPct: number | null;
  points: number;
};

export type SubmissionRules = {
  /** A live quote older than this (seconds) is refused while the market is open. */
  maxQuoteAgeSeconds: number;
  /** Daily closes used to estimate volatility for the band. */
  volatilityLookbackSessions: number;
  maxNewPerDay: number;
  /**
   * Instruments that barely move (liquid and bond ETFs): a call on them is a
   * near-free SIDEWAYS win, so they can't be predicted.
   */
  excludedSymbols: string[];
};

export type ScoringConfig = {
  version: string;
  horizons: Record<Horizon, HorizonRules>;
  /** Band = clamp(sidewaysVolatilityFactor × σ over the time frame, floor, ceiling). */
  sidewaysVolatilityFactor: number;
  /** Band used when no volatility is known: this × k, then clamped. */
  defaultBandPctPerK: number;
  /** Incorrect-direction penalty bands, on normalised error (error ÷ k). */
  penaltyBands: PenaltyBand[];
  /** Penalty is multiplied by base ÷ penaltyScaleDivisor (×1 / ×2 / ×3). */
  penaltyScaleDivisor: number;
  /** Per-prediction cap: penalty ≤ capMultiplier × base. */
  penaltyCapMultiplier: number;
  /** Target points for correct UP/DOWN calls, on normalised target error. */
  targetBands: TargetBand[];
  /** Furthest a target may be from entry: maxTargetPctPerK × k (%). */
  maxTargetPctPerK: number;
  /** Decisions compare the move rounded to this many decimals (%). */
  decisionDecimals: number;
  submission: SubmissionRules;
};

export const SCORING_V2: ScoringConfig = {
  version: "scoring-v2-2026-10",
  horizons: {
    "1d": { base: 10, k: 1, sessions: 1, cryptoHours: 24, bandFloorPct: 0.25, bandCeilingPct: 1.5, maxPlausibleMovePct: 40 },
    "1w": { base: 20, k: 2, sessions: 5, cryptoHours: 24 * 7, bandFloorPct: 0.5, bandCeilingPct: 3, maxPlausibleMovePct: 60 },
    "1m": { base: 30, k: 4, sessions: 21, cryptoHours: 24 * 30, bandFloorPct: 1, bandCeilingPct: 6, maxPlausibleMovePct: 100 },
  },
  sidewaysVolatilityFactor: 0.5,
  defaultBandPctPerK: 0.5,
  penaltyBands: [
    { upToPct: 1, points: 2 },
    { upToPct: 3, points: 5 },
    { upToPct: 5, points: 10 },
    { upToPct: 10, points: 15 },
    { upToPct: null, points: 20 },
  ],
  penaltyScaleDivisor: 10,
  penaltyCapMultiplier: 2,
  targetBands: [
    { upToPct: 1, points: 10 },
    { upToPct: 3, points: 5 },
    { upToPct: 5, points: 0 },
    { upToPct: null, points: -5 },
  ],
  maxTargetPctPerK: 10,
  decisionDecimals: 6,
  submission: {
    maxQuoteAgeSeconds: 120,
    volatilityLookbackSessions: 60,
    maxNewPerDay: 10,
    excludedSymbols: ["LIQUIDBEES", "GILT5YBEES", "LTGILTBEES", "EBBETF0430", "EBBETF0431", "EBBETF0433"],
  },
};

/** JSON with object keys sorted, so the same rules always serialise the same way. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, v]) => `${JSON.stringify(key)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * A short, stable fingerprint of a configuration (FNV-1a, 32-bit, hex). Stored
 * beside each result so an edited-but-not-re-versioned config is detectable.
 */
export function configFingerprint(config: ScoringConfig): string {
  const text = stableStringify(config);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
