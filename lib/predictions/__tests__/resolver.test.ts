import { test } from "node:test";
import assert from "node:assert/strict";

import type { Candle } from "../../apis/yahooChart";
import { buildRecord, decideExit, resolveDuePredictions, type DuePrediction, type ResolutionRecord, type ResolverStore } from "../resolver";
import { SCORING_V2, configFingerprint } from "../v2";
import { findCryptoExit, findSessionExit, sessionDate } from "../v2/resolution";

const IST = "Asia/Kolkata";
// NSE daily bars are stamped at the 09:15 IST open (03:45 UTC).
const bar = (day: string, close: number): Candle => ({ t: Date.parse(`${day}T03:45:00.000Z`), o: close, h: close, l: close, c: close, v: 1 });
const at = (iso: string) => Date.parse(iso);

// Mon 19 Oct → Fri 23 Oct 2026, then Mon 26 (a holiday is simulated by leaving Tue 27 out).
const week = [bar("2026-10-16", 98), bar("2026-10-19", 100), bar("2026-10-20", 101), bar("2026-10-21", 102), bar("2026-10-22", 103), bar("2026-10-23", 104), bar("2026-10-26", 105), bar("2026-10-28", 106)];

const base = {
  daily: week,
  timeZone: IST,
  todaySession: null,
  estimatedExpiryAt: at("2026-10-23T10:00:00.000Z"),
};

test("session dates are taken in the exchange's time zone", () => {
  assert.equal(sessionDate(at("2026-10-19T03:45:00.000Z"), IST), "2026-10-19");
  assert.equal(sessionDate(at("2026-10-19T20:00:00.000Z"), IST), "2026-10-20");
});

test("a live call's first session is the day it was made; the Nth close is the exit", () => {
  const decision = findSessionExit({ ...base, referenceMode: "live", referenceQuoteTime: at("2026-10-19T08:00:00.000Z"), expirySessions: 5, now: at("2026-10-24T08:00:00.000Z") });
  assert.deepEqual(decision, { kind: "exit", price: 104, session: "2026-10-23", barTime: at("2026-10-23T03:45:00.000Z") });
});

test("a from-close call starts counting after the reference session", () => {
  // Made at the weekend from Friday 16th's close: session 1 is Monday 19th.
  const decision = findSessionExit({ ...base, referenceMode: "from_close", referenceQuoteTime: at("2026-10-16T03:45:00.000Z"), expirySessions: 1, now: at("2026-10-20T08:00:00.000Z") });
  assert.equal(decision.kind === "exit" && decision.session, "2026-10-19");
});

test("holidays are skipped because sessions are counted from real bars", () => {
  // 7 sessions from Mon 19: 19,20,21,22,23,26,28 (27 missing).
  const decision = findSessionExit({ ...base, referenceMode: "live", referenceQuoteTime: at("2026-10-19T08:00:00.000Z"), expirySessions: 7, estimatedExpiryAt: at("2026-10-27T10:00:00.000Z"), now: at("2026-10-29T08:00:00.000Z") });
  assert.equal(decision.kind === "exit" && decision.session, "2026-10-28");
});

test("today's bar isn't used until its session has ended and settled", () => {
  const input = { ...base, referenceMode: "live" as const, referenceQuoteTime: at("2026-10-23T05:00:00.000Z"), expirySessions: 1 };
  const session = { start: at("2026-10-23T03:45:00.000Z"), end: at("2026-10-23T10:00:00.000Z") };
  assert.deepEqual(findSessionExit({ ...input, todaySession: session, now: at("2026-10-23T09:00:00.000Z") }), { kind: "wait" });
  assert.deepEqual(findSessionExit({ ...input, todaySession: session, now: at("2026-10-23T10:20:00.000Z") }), { kind: "wait" });
  assert.equal(findSessionExit({ ...input, todaySession: session, now: at("2026-10-23T10:31:00.000Z") }).kind, "exit");
  assert.deepEqual(findSessionExit({ ...input, todaySession: null, now: at("2026-10-23T11:00:00.000Z") }), { kind: "wait" });
});

test("no exit data: wait, then void after the grace period", () => {
  const input = { ...base, daily: [], referenceMode: "live" as const, referenceQuoteTime: at("2026-10-19T08:00:00.000Z"), expirySessions: 5 };
  assert.deepEqual(findSessionExit({ ...input, now: at("2026-10-25T08:00:00.000Z") }), { kind: "wait" });
  assert.deepEqual(findSessionExit({ ...input, now: at("2026-11-02T08:00:00.000Z") }), { kind: "void", reason: "no-exit-data" });
});

test("crypto exits at the first bar at or after expiry", () => {
  const bars: Candle[] = [1, 2, 3].map((h) => ({ t: at(`2026-10-20T0${h}:00:00.000Z`), o: 1, h: 1, l: 1, c: 100 + h, v: 1 }));
  assert.deepEqual(findCryptoExit({ bars, expiresAt: at("2026-10-20T01:30:00.000Z"), now: at("2026-10-20T04:00:00.000Z") }), {
    kind: "exit",
    price: 102,
    session: null,
    barTime: at("2026-10-20T02:00:00.000Z"),
  });
  assert.deepEqual(findCryptoExit({ bars, expiresAt: at("2026-10-20T03:58:00.000Z"), now: at("2026-10-20T04:00:00.000Z") }), { kind: "wait" });
});

const prediction: DuePrediction = {
  id: "p1",
  assetType: "stock",
  symbol: "TCS",
  direction: "up",
  horizon: "1w",
  targetPrice: null,
  referencePrice: 100,
  referenceMode: "live",
  referenceQuoteTime: "2026-10-19T08:00:00.000Z",
  currency: "INR",
  bandPct: 1,
  expirySessions: 5,
  expiresAt: null,
  estimatedExpiryAt: "2026-10-23T10:00:00.000Z",
};

test("a record carries the score, exit and the scoring version + fingerprint", () => {
  const record = buildRecord(prediction, { kind: "exit", price: 104, session: "2026-10-23", barTime: 0 }, "yahoo");
  assert.equal(record.outcome, "correct");
  assert.equal(record.counted, true);
  assert.equal(record.directionPoints, 20);
  assert.equal(record.exitPrice, 104);
  assert.equal(record.exitSession, "2026-10-23");
  assert.equal(record.scoringVersion, SCORING_V2.version);
  assert.equal(record.configFingerprint, configFingerprint(SCORING_V2));

  const wrong = buildRecord(prediction, { kind: "exit", price: 95, session: "2026-10-23", barTime: 0 }, "yahoo");
  assert.equal(wrong.outcome, "incorrect");
  assert.ok(wrong.directionPoints < 0);

  const voided = buildRecord(prediction, { kind: "void", reason: "no-exit-data" }, null);
  assert.deepEqual([voided.outcome, voided.counted, voided.directionPoints, voided.exitPrice], ["void", false, 0, null]);
});

test("the resolver scores due predictions once, waits on unfinished ones and fetches each symbol once", async () => {
  const records: ResolutionRecord[] = [];
  const store: ResolverStore = {
    due: async () => [prediction, { ...prediction, id: "p2" }, { ...prediction, id: "p3", symbol: "INFY", expirySessions: 21 }],
    record: async (r) => {
      records.push(r);
      return r.predictionId !== "p2"; // p2 was resolved by another run
    },
  };
  const fetched: string[] = [];
  const result = await resolveDuePredictions(
    store,
    {
      daily: async (_type, symbol) => {
        fetched.push(symbol);
        return { candles: week, source: "yahoo", session: null };
      },
      intraday: async () => null,
    },
    at("2026-10-24T08:00:00.000Z")
  );

  assert.deepEqual(result, { resolved: 1, waiting: 1, failed: 0 });
  assert.deepEqual(records.map((r) => r.predictionId), ["p1", "p2"]);
  assert.deepEqual(fetched.sort(), ["INFY", "TCS"]);
});

test("decideExit voids a prediction with no expiry recorded", () => {
  assert.deepEqual(decideExit({ ...prediction, expirySessions: null }, null, Date.now()), { kind: "void", reason: "no-expiry" });
  assert.deepEqual(decideExit({ ...prediction, assetType: "crypto", expiresAt: null }, null, Date.now()), { kind: "void", reason: "no-expiry" });
});

import { MIN_RANKED, adjustedAccuracy, rankLeaders } from "../reputation";

test("leaderboard: a short lucky streak can't outrank a long good record", () => {
  assert.equal(adjustedAccuracy({ resolved: 0, wins: 0, points: 0 }), 50);
  const lucky = { name: "lucky", stats: { resolved: MIN_RANKED, wins: MIN_RANKED, points: 400 } };
  const steady = { name: "steady", stats: { resolved: 200, wins: 140, points: 900 } };
  const newbie = { name: "newbie", stats: { resolved: 5, wins: 5, points: 100 } };

  const ranked = rankLeaders([newbie, steady, lucky]);
  assert.deepEqual(ranked.map((r) => [r.name, r.rank]), [["lucky", 1], ["steady", 2], ["newbie", null]]);
  // 20/20 → (25/30) 83.3%; 140/200 → (145/210) 69.0%
  assert.equal(ranked[0].adjustedAccuracy, 83.3);
  assert.equal(ranked[1].adjustedAccuracy, 69);
});
