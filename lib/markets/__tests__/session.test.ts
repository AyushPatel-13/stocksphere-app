import { test } from "node:test";
import assert from "node:assert/strict";

import { marketSession, scheduledOpenButQuiet } from "../session";

// 2026-10-23 is a Friday; 2026-10-24 a Saturday.
const at = (iso: string) => Date.parse(iso);

test("India is open on a weekday between 09:15 and 15:30 IST", () => {
  const s = marketSession("IN", at("2026-10-23T05:00:00Z")); // 10:30 IST
  assert.equal(s.scheduled, "open");
  assert.equal(s.label, "Open");
  assert.equal(s.localTime, "10:30 IST");
});

test("India before 09:15 is pre-open and after 15:30 is closed", () => {
  assert.equal(marketSession("IN", at("2026-10-23T03:30:00Z")).label, "Pre-open"); // 09:00 IST
  assert.equal(marketSession("IN", at("2026-10-23T10:00:00Z")).label, "Closed"); // 15:30 IST
});

test("weekends are closed in both markets", () => {
  assert.equal(marketSession("IN", at("2026-10-24T06:00:00Z")).label, "Closed · weekend");
  assert.equal(marketSession("US", at("2026-10-24T15:00:00Z")).label, "Closed · weekend");
});

test("the US session follows New York time, including daylight saving", () => {
  // 23 Oct 2026 is EDT (UTC−4): 13:30Z is 09:30 ET.
  assert.equal(marketSession("US", at("2026-10-23T13:30:00Z")).scheduled, "open");
  assert.equal(marketSession("US", at("2026-10-23T13:29:00Z")).label, "Pre-open");
  // 4 Dec 2026 is EST (UTC−5): 14:29Z is 09:29 ET.
  assert.equal(marketSession("US", at("2026-12-04T14:29:00Z")).label, "Pre-open");
  assert.equal(marketSession("US", at("2026-12-04T20:59:00Z")).scheduled, "open");
});

test("a stale quote during scheduled hours is flagged as quiet", () => {
  const now = at("2026-10-20T06:00:00Z"); // a Tuesday, 11:30 IST (Dussehra holiday)
  const s = marketSession("IN", now);
  assert.equal(scheduledOpenButQuiet(s, at("2026-10-19T10:29:00Z"), now), true);
  assert.equal(scheduledOpenButQuiet(s, now - 60_000, now), false);
  assert.equal(scheduledOpenButQuiet(s, null, now), false);
  assert.equal(scheduledOpenButQuiet(marketSession("IN", at("2026-10-24T06:00:00Z")), 0, now), false);
});
