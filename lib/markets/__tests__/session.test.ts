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

import { parseUpstoxHolidays, usMarketHoliday } from "../holidays";
import { createCalendarLoader } from "@/lib/services/marketCalendar";
import { GET as calendarRoute } from "@/app/api/market/calendar/route";

// As Upstox's GET /v2/market/holidays answered on 10 Nov 2026 (three of its rows, and two that must be ignored).
const UPSTOX_HOLIDAYS = {
  status: "success",
  data: [
    { date: "2026-01-26", description: "Republic Day", holiday_type: "TRADING_HOLIDAY", closed_exchanges: ["NSE", "NFO", "CDS", "BSE", "BFO", "BCD", "MCX", "NSCOM"], open_exchanges: [] },
    {
      date: "2026-11-08", description: "Diwali Laxmi Pujan", holiday_type: "SPECIAL_TIMING", closed_exchanges: [],
      open_exchanges: [{ exchange: "MCX", start_time: 1794127800000, end_time: 1794132000000 }, { exchange: "NSE", start_time: 1794127800000, end_time: 1794132000000 }],
    },
    {
      date: "2026-11-10", description: "Diwali-Balipratipada", holiday_type: "TRADING_HOLIDAY", closed_exchanges: ["NSE", "NFO", "CDS", "BSE", "BFO", "BCD"],
      open_exchanges: [{ exchange: "MCX", start_time: 1794310200000, end_time: 1794335100000 }],
    },
    // A settlement holiday: NSE trades its regular hours (09:15–15:30 IST), so it isn't a special day.
    {
      date: "2026-04-01", description: "Annual Bank Closing", holiday_type: "SETTLEMENT_HOLIDAY", closed_exchanges: ["CDS", "BCD"],
      open_exchanges: [{ exchange: "NSE", start_time: 1775015100000, end_time: 1775037600000 }],
    },
    { date: "soon", description: "Not a date", closed_exchanges: ["NSE"] },
  ],
};

test("NSE's holidays and special sessions are read from Upstox's list; rows about other exchanges are ignored", () => {
  assert.deepEqual(parseUpstoxHolidays(UPSTOX_HOLIDAYS), [
    { date: "2026-01-26", description: "Republic Day", closed: true },
    { date: "2026-11-08", description: "Diwali Laxmi Pujan", closed: false, session: { start: 1794127800000, end: 1794132000000 } },
    { date: "2026-11-10", description: "Diwali-Balipratipada", closed: true },
  ]);
  for (const bad of [null, "x", {}, { data: "no" }, { data: [null, 5, {}] }]) assert.deepEqual(parseUpstoxHolidays(bad), []);
});

test("India is closed on an exchange holiday and open for a special session, and says why", () => {
  const calendar = { india: parseUpstoxHolidays(UPSTOX_HOLIDAYS) };

  // Tue 10 Nov 2026, 11:00 IST: a weekday inside regular hours, but a holiday.
  const holiday = marketSession("IN", at("2026-11-10T05:30:00Z"), calendar);
  assert.deepEqual([holiday.scheduled, holiday.label, holiday.occasion], ["closed", "Closed · Diwali-Balipratipada", "Diwali-Balipratipada"]);
  // Without the calendar the timetable alone says open: the bug this fixes.
  assert.equal(marketSession("IN", at("2026-11-10T05:30:00Z")).scheduled, "open");

  // Sun 8 Nov 2026: the Muhurat session ran 14:20–15:30 IST.
  const during = marketSession("IN", 1794127800000 + 30 * 60_000, calendar);
  assert.deepEqual([during.scheduled, during.label], ["open", "Open · special session until 15:30"]);
  const before = marketSession("IN", at("2026-11-08T05:30:00Z"), calendar);
  assert.deepEqual([before.scheduled, before.label], ["closed", "Closed · special session 14:20–15:30"]);
  assert.equal(marketSession("IN", 1794132000000, calendar).scheduled, "closed"); // the closing minute

  // A settlement holiday is an ordinary trading day.
  assert.equal(marketSession("IN", at("2026-04-01T05:30:00Z"), calendar).label, "Open");
  // An ordinary day is untouched, and India's calendar never closes the US.
  assert.equal(marketSession("IN", at("2026-11-09T05:30:00Z"), calendar).label, "Open");
  assert.equal(marketSession("US", at("2026-11-10T16:00:00Z"), calendar).label, "Open");
});

test("US market holidays follow NYSE's rules, including weekend observance", () => {
  const expected: Record<string, string> = {
    "2026-01-01": "New Year's Day",
    "2026-01-19": "Martin Luther King Jr. Day",
    "2026-02-16": "Washington's Birthday",
    "2026-04-03": "Good Friday",
    "2026-05-25": "Memorial Day",
    "2026-06-19": "Juneteenth",
    "2026-07-03": "Independence Day", // 4 July 2026 is a Saturday
    "2026-09-07": "Labor Day",
    "2026-11-26": "Thanksgiving",
    "2026-12-25": "Christmas Day",
    "2027-07-05": "Independence Day", // 4 July 2027 is a Sunday
    "2025-04-18": "Good Friday",
    "2024-03-29": "Good Friday",
  };
  for (const [date, name] of Object.entries(expected)) assert.equal(usMarketHoliday(date), name, date);
  // 1 Jan 2028 is a Saturday: NYSE has no day off for it (31 Dec 2027 trades).
  for (const open of ["2027-12-31", "2028-01-01", "2026-07-04", "2026-11-27", "2026-11-10", "nonsense"]) assert.equal(usMarketHoliday(open), null, open);

  // Thanksgiving 2026 at 11:00 ET: closed, with the reason.
  const thanksgiving = marketSession("US", at("2026-11-26T16:00:00Z"));
  assert.deepEqual([thanksgiving.scheduled, thanksgiving.label], ["closed", "Closed · Thanksgiving"]);
});

test("the calendar is kept for 12 hours, survives an outage, and is never an invented empty list", async () => {
  let clock = 0;
  let calls = 0;
  let answer: unknown = UPSTOX_HOLIDAYS;
  const load = createCalendarLoader(async () => {
    calls++;
    if (answer instanceof Error) throw answer;
    return answer;
  }, () => clock);

  assert.equal((await load())?.india.length, 3);
  await load();
  assert.equal(calls, 1);

  // Upstox down after the 12 hours: the last good list, and no retry storm.
  clock = 13 * 3_600_000;
  answer = new Error("429");
  assert.equal((await load())?.india.length, 3);
  await load();
  assert.equal(calls, 2);

  // Never loaded and unavailable (or an error body): null, and the route says 503 rather than "no holidays".
  for (const bad of [null, { status: "error" }, { status: "success", data: [] }]) {
    assert.equal(await createCalendarLoader(async () => bad, () => 0)(), null);
  }
  assert.equal((await calendarRoute(undefined, undefined, async () => null)).status, 503);
  const ok = await calendarRoute(undefined, undefined, async () => ({ india: parseUpstoxHolidays(UPSTOX_HOLIDAYS), source: "Upstox", fetchedAt: "2026-11-10T00:00:00.000Z" }));
  assert.equal((await ok.json()).india.length, 3);
});
