import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SCORING_V2,
  configFingerprint,
  dailyVolatilityPct,
  movePct,
  movementBandPct,
  resolveDirection,
  scorePredictionV2,
  validateTarget,
  type ScoringConfig,
} from "../v2";

const score = (input: Parameters<typeof scorePredictionV2>[0], config?: ScoringConfig) =>
  scorePredictionV2(input, config);

/* ------------------------------------------------------------ config */

test("the config is versioned and fingerprinted; any edit changes the fingerprint", () => {
  assert.match(SCORING_V2.version, /^scoring-v2-/);
  const fp = configFingerprint(SCORING_V2);
  assert.match(fp, /^[0-9a-f]{8}$/);
  assert.equal(configFingerprint(structuredClone(SCORING_V2)), fp);

  const edited = structuredClone(SCORING_V2);
  edited.penaltyBands[0].points = 3;
  assert.notEqual(configFingerprint(edited), fp);

  const result = score({ direction: "up", horizon: "1d", entry: 100, exit: 102, bandPct: 0.5 });
  assert.equal(result.version, SCORING_V2.version);
  assert.equal(result.fingerprint, fp);
});

test("base rewards are unchanged: 10 / 20 / 30", () => {
  assert.equal(SCORING_V2.horizons["1d"].base, 10);
  assert.equal(SCORING_V2.horizons["1w"].base, 20);
  assert.equal(SCORING_V2.horizons["1m"].base, 30);
});

/* ------------------------------------------------------------ band */

test("band = clamp(0.5 × daily volatility × √sessions, floor, ceiling)", () => {
  assert.equal(movementBandPct("1d", 1.2), 0.6); // 0.5 × 1.2 × 1
  assert.equal(movementBandPct("1w", 1.2), 1.3416); // 0.5 × 1.2 × √5
  assert.equal(movementBandPct("1d", 0.1), 0.25); // floor
  assert.equal(movementBandPct("1d", 9), 1.5); // ceiling
  assert.equal(movementBandPct("1m", 0.05), 1); // a near-still asset can't get a tiny band
  // No volatility known: 0.5% × k, clamped.
  assert.equal(movementBandPct("1d", null), 0.5);
  assert.equal(movementBandPct("1w", null), 1);
  assert.equal(movementBandPct("1m", null), 2);
});

test("daily volatility is the sample standard deviation of daily % returns", () => {
  assert.equal(dailyVolatilityPct([100, 100, 100, 100]), 0);
  const vol = dailyVolatilityPct([100, 101, 100, 101]);
  assert.ok(vol !== null && vol > 0.9 && vol < 1.2);
  assert.equal(dailyVolatilityPct([100, 101]), null);
  assert.equal(dailyVolatilityPct([100, 0, 101]), null);
});

/* ------------------------------------------------------------ direction */

test("UP: correct at +b or more, incorrect at −b or less, flat in between (boundaries inclusive)", () => {
  const r = (exit: number) => resolveDirection({ direction: "up", horizon: "1d", entry: 1000, exit, bandPct: 0.5 }).outcome;
  assert.equal(r(1005), "correct"); // exactly +0.5%
  assert.equal(r(1012), "correct");
  assert.equal(r(1004.99), "flat");
  assert.equal(r(997), "flat");
  assert.equal(r(995), "incorrect"); // exactly −0.5%
});

test("DOWN mirrors UP", () => {
  const r = (exit: number) => resolveDirection({ direction: "down", horizon: "1w", entry: 1000, exit, bandPct: 1 }).outcome;
  assert.equal(r(990), "correct");
  assert.equal(r(1009), "flat");
  assert.equal(r(1010), "incorrect");
  assert.equal(r(1021), "incorrect");
});

test("SIDEWAYS: correct strictly inside the band, incorrect on or outside it", () => {
  const r = (exit: number) => resolveDirection({ direction: "sideways", horizon: "1w", entry: 1000, exit, bandPct: 1 }).outcome;
  assert.equal(r(1006), "correct");
  assert.equal(r(995), "correct");
  assert.equal(r(1010), "incorrect"); // exactly the band edge
  assert.equal(r(985), "incorrect");
});

test("region error measures distance outside the predicted region", () => {
  const up = resolveDirection({ direction: "up", horizon: "1d", entry: 1000, exit: 990, bandPct: 0.5 });
  assert.equal(up.outcome === "incorrect" && up.regionErrorPct, 1.5); // edge 1,005 → 990
  const down = resolveDirection({ direction: "down", horizon: "1w", entry: 1000, exit: 1140, bandPct: 1 });
  assert.equal(down.outcome === "incorrect" && down.regionErrorPct, 15); // edge 990 → 1,140
  const side = resolveDirection({ direction: "sideways", horizon: "1w", entry: 1000, exit: 1035, bandPct: 1 });
  assert.equal(side.outcome === "incorrect" && side.regionErrorPct, 2.5); // 3.5% − 1%
});

test("float noise doesn't flip an exact-boundary decision", () => {
  assert.equal(movePct(0.3, 0.1 + 0.2), 0);
  const r = resolveDirection({ direction: "up", horizon: "1d", entry: 2456.1, exit: 2456.1 * 1.005, bandPct: 0.5 });
  assert.equal(r.outcome, "correct");
});

/* ------------------------------------------------------------ penalties */

test("penalty bands apply to error ÷ k, inclusive upper bounds", () => {
  // 1D (k = 1, ×1): region error = b − m with b = 0.5 → choose exits for exact errors.
  const pen = (regionErrorPct: number) =>
    score({ direction: "up", horizon: "1d", entry: 1000, exit: 1000 * (1 + (0.5 - regionErrorPct) / 100), bandPct: 0.5 }).totalPoints;
  assert.equal(pen(1), -2);
  assert.equal(pen(1.01), -5);
  assert.equal(pen(3), -5);
  assert.equal(pen(5), -10);
  assert.equal(pen(10), -15);
  assert.equal(pen(10.5), -20);
  assert.equal(pen(35), -20); // cap
});

test("penalties scale with the horizon (×1 / ×2 / ×3) and are capped at 2 × base", () => {
  // Same normalised error (2%) on each horizon → band −5, then × base ÷ 10.
  const err = (horizon: "1d" | "1w" | "1m", k: number) =>
    score({ direction: "up", horizon, entry: 1000, exit: 1000 * (1 + (0.5 - 2 * k) / 100), bandPct: 0.5 }).totalPoints;
  assert.equal(err("1d", 1), -5);
  assert.equal(err("1w", 2), -10);
  assert.equal(err("1m", 4), -15);

  // Worst band on 1M: −20 × 3 = −60 = the 2 × base cap.
  assert.equal(score({ direction: "down", horizon: "1m", entry: 100, exit: 199, bandPct: 1 }).totalPoints, -60);

  // A tighter cap in a custom config is respected.
  const tight = structuredClone(SCORING_V2);
  tight.penaltyCapMultiplier = 1;
  assert.equal(score({ direction: "down", horizon: "1m", entry: 100, exit: 199, bandPct: 1 }, tight).totalPoints, -30);
});

test("a wrong call is penalised once: its target is ignored", () => {
  const withTarget = score({ direction: "up", horizon: "1d", entry: 1000, exit: 990, bandPct: 0.5, target: 1050 });
  const without = score({ direction: "up", horizon: "1d", entry: 1000, exit: 990, bandPct: 0.5 });
  assert.equal(withTarget.totalPoints, -5);
  assert.equal(without.totalPoints, -5);
  assert.equal(withTarget.targetPoints, 0);
  assert.equal(withTarget.targetErrorPct, null);
});

/* ------------------------------------------------------------ targets */

test("target points: reached or ≤1% +10, ≤3% +5, ≤5% 0, over 5% −5 (error ÷ k)", () => {
  const t = (exit: number, target: number, horizon: "1d" | "1w" = "1d") =>
    score({ direction: "up", horizon, entry: 1000, exit, bandPct: 0.5, target });
  assert.equal(t(1025, 1020).targetPoints, 10); // reached
  assert.equal(t(1025, 1020).targetReached, true);
  assert.equal(t(1016, 1020).targetPoints, 10); // 0.4%
  assert.equal(t(1010, 1030).targetPoints, 5); // 2%
  assert.equal(t(1010, 1050).targetPoints, 0); // 4%
  assert.equal(t(1010, 1090).targetPoints, -5); // 8%
  assert.equal(t(1010, 1090).totalPoints, 5); // a correct call stays positive
  // 1W halves the distance: 4% ÷ 2 = 2% → +5.
  assert.equal(t(1010, 1050, "1w").targetPoints, 5);
});

test("DOWN targets are reached at or below the target", () => {
  const r = score({ direction: "down", horizon: "1w", entry: 1000, exit: 955, bandPct: 1, target: 960 });
  assert.equal(r.targetReached, true);
  assert.equal(r.totalPoints, 30);
});

/* ------------------------------------------------------------ not counted */

test("flat, void and review score 0 and are not counted", () => {
  const flat = score({ direction: "up", horizon: "1d", entry: 1000, exit: 997, bandPct: 0.5 });
  assert.deepEqual([flat.outcome, flat.counted, flat.totalPoints], ["flat", false, 0]);

  const badPrice = score({ direction: "up", horizon: "1d", entry: 1000, exit: Number.NaN, bandPct: 0.5 });
  assert.deepEqual([badPrice.outcome, badPrice.counted, badPrice.reason], ["void", false, "invalid-price"]);

  assert.equal(score({ direction: "up", horizon: "1d", entry: 0, exit: 10, bandPct: 0.5 }).outcome, "void");
  assert.equal(score({ direction: "up", horizon: "1d", entry: 100, exit: 101, bandPct: -1 }).outcome, "void");

  const sidewaysTarget = score({ direction: "sideways", horizon: "1d", entry: 100, exit: 100, bandPct: 0.5, target: 101 });
  assert.deepEqual([sidewaysTarget.outcome, sidewaysTarget.reason], ["void", "invalid-target"]);

  // A 50% one-day move is more likely a split than a real move.
  const split = score({ direction: "down", horizon: "1d", entry: 1000, exit: 500, bandPct: 0.5 });
  assert.deepEqual([split.outcome, split.counted, split.reason], ["review", false, "implausible-move"]);
});

/* ------------------------------------------------------------ submission */

test("targets must be beyond the band edge, on the predicted side, and not extreme", () => {
  assert.deepEqual(validateTarget("up", "1d", 1000, null, 0.5), { ok: true });
  assert.deepEqual(validateTarget("up", "1d", 1000, 1020, 0.5), { ok: true });
  assert.equal(validateTarget("up", "1d", 1000, 1003, 0.5).ok, false); // inside the band
  assert.equal(validateTarget("up", "1d", 1000, 990, 0.5).ok, false); // wrong side
  assert.equal(validateTarget("down", "1d", 1000, 980, 0.5).ok, true);
  assert.equal(validateTarget("up", "1d", 1000, 1150, 0.5).ok, false); // > 10% for 1D
  assert.equal(validateTarget("up", "1m", 1000, 1350, 2).ok, true); // ≤ 40% for 1M
  assert.equal(validateTarget("sideways", "1w", 1000, 1010, 1).ok, false);
});

/* ------------------------------------------------------------ worked examples from the plan */

test("worked examples", () => {
  const ex = (input: Parameters<typeof scorePredictionV2>[0]) => score(input).totalPoints;

  assert.equal(ex({ direction: "up", horizon: "1d", entry: 1000, exit: 1016, bandPct: 0.5, target: 1020 }), 20);
  assert.equal(ex({ direction: "up", horizon: "1d", entry: 1000, exit: 990, bandPct: 0.5, target: 1020 }), -5);
  assert.equal(ex({ direction: "down", horizon: "1w", entry: 1000, exit: 1140, bandPct: 1 }), -30);
  assert.equal(ex({ direction: "sideways", horizon: "1w", entry: 1000, exit: 1035, bandPct: 1 }), -10);
  assert.equal(ex({ direction: "up", horizon: "1d", entry: 1000, exit: 1012, bandPct: 0.5 }), 10);
  assert.equal(ex({ direction: "sideways", horizon: "1w", entry: 1000, exit: 1006, bandPct: 1 }), 20);

  // TCS 1W UP, entry ₹2,456.10, target ₹2,550, exit ₹2,520, band 1%:
  // move +2.60% → +20; target error 1.22% ÷ 2 = 0.61% → +10.
  const tcs = score({ direction: "up", horizon: "1w", entry: 2456.1, exit: 2520, bandPct: 1, target: 2550 });
  assert.equal(tcs.outcome, "correct");
  assert.equal(tcs.totalPoints, 30);
  assert.ok(Math.abs((tcs.targetErrorPct ?? 0) - 0.6107) < 0.001);
});
