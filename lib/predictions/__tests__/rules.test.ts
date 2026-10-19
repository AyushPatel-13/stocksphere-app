import { test } from "node:test";
import assert from "node:assert/strict";

import {
  accuracy,
  badgeFor,
  checkNewPrediction,
  nextBadge,
  resolvesAt,
  scorePrediction,
  targetOnRightSide,
} from "../rules";

test("right direction wins the horizon's points; wrong direction loses with 0", () => {
  assert.deepEqual(
    { ...scorePrediction({ direction: "up", horizon: "1d", entry: 100, exit: 102 }), movePct: 0 },
    { status: "won", points: 10, movePct: 0 }
  );
  assert.equal(scorePrediction({ direction: "up", horizon: "1w", entry: 100, exit: 105 }).points, 20);
  assert.equal(scorePrediction({ direction: "down", horizon: "1m", entry: 100, exit: 90 }).points, 30);

  const lost = scorePrediction({ direction: "up", horizon: "1m", entry: 100, exit: 95 });
  assert.equal(lost.status, "lost");
  assert.equal(lost.points, 0);
});

test("a flat move is void, not a win or a loss", () => {
  assert.equal(scorePrediction({ direction: "up", horizon: "1d", entry: 1000, exit: 1000.4 }).status, "void");
  assert.equal(scorePrediction({ direction: "down", horizon: "1d", entry: 1000, exit: 1000 }).status, "void");
});

test("target bonus: +10 when reached or within 1%, +5 within 3%, nothing further away", () => {
  const base = { direction: "up" as const, horizon: "1d" as const, entry: 100 };
  assert.equal(scorePrediction({ ...base, exit: 111, target: 110 }).points, 20); // beyond target
  assert.equal(scorePrediction({ ...base, exit: 109.5, target: 110 }).points, 20); // within 1%
  assert.equal(scorePrediction({ ...base, exit: 107.5, target: 110 }).points, 15); // within 3%
  assert.equal(scorePrediction({ ...base, exit: 103, target: 110 }).points, 10); // no bonus
  // A target never rescues a wrong call.
  assert.equal(scorePrediction({ ...base, exit: 95, target: 110 }).points, 0);
});

test("badges need both volume and accuracy", () => {
  assert.equal(badgeFor({ resolved: 0, wins: 0, points: 0 }), null);
  assert.equal(badgeFor({ resolved: 3, wins: 3, points: 30 }), null); // lucky streak, too few
  assert.equal(badgeFor({ resolved: 10, wins: 5, points: 50 })?.id, "analyst");
  assert.equal(badgeFor({ resolved: 30, wins: 15, points: 0 })?.id, "analyst"); // 50%: not Pro yet
  assert.equal(badgeFor({ resolved: 30, wins: 17, points: 0 })?.id, "pro");
  assert.equal(badgeFor({ resolved: 60, wins: 36, points: 0 })?.id, "expert");
  assert.equal(badgeFor({ resolved: 120, wins: 80, points: 0 })?.id, "master");
  assert.equal(badgeFor({ resolved: 200, wins: 80, points: 0 }), null); // 40%: no badge
  assert.equal(accuracy({ resolved: 4, wins: 1, points: 0 }), 25);
});

test("next badge tells you what's left", () => {
  const fresh = nextBadge({ resolved: 4, wins: 3, points: 0 });
  assert.equal(fresh?.badge.id, "analyst");
  assert.equal(fresh?.needResolved, 6);

  assert.equal(nextBadge({ resolved: 120, wins: 80, points: 0 }), null);
});

test("new predictions: valid input, daily cap and one open call per asset and time frame", () => {
  const ok = { direction: "up", horizon: "1w", target: "", todayCount: 0, openOnSameCall: false };
  assert.deepEqual(checkNewPrediction(ok), { ok: true });
  assert.equal(checkNewPrediction({ ...ok, direction: "sideways" }).ok, false);
  assert.equal(checkNewPrediction({ ...ok, horizon: "1y" }).ok, false);
  assert.equal(checkNewPrediction({ ...ok, target: "-5" }).ok, false);
  assert.equal(checkNewPrediction({ ...ok, todayCount: 10 }).ok, false);
  assert.equal(checkNewPrediction({ ...ok, openOnSameCall: true }).ok, false);

  assert.equal(targetOnRightSide("up", 100, 110), true);
  assert.equal(targetOnRightSide("up", 100, 90), false);
  assert.equal(targetOnRightSide("down", 100, 90), true);
  assert.equal(targetOnRightSide("down", 100, null), true);
});

test("resolution time is the horizon after creation", () => {
  const created = Date.parse("2026-10-19T05:00:00Z");
  assert.equal(resolvesAt(created, "1w").toISOString(), "2026-10-26T05:00:00.000Z");
});
