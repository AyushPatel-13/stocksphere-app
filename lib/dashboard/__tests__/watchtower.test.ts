import { test } from "node:test";
import assert from "node:assert/strict";

import { SAME_VISIT_MS, buildWatchtower, parseStoredSnapshots, rollSnapshots, type WatchtowerInput } from "../watchtower";

const money = (amount: number, currency: string) => `${currency} ${amount.toFixed(2)}`;
const NOW = Date.parse("2026-10-24T06:00:00Z");
const HOUR = 3_600_000;

const empty: WatchtowerInput = { now: NOW, baseline: null, quotes: [], notifications: [], earnings: [], ipos: [], news: [] };

test("no data gives an empty feed", () => {
  assert.deepEqual(buildWatchtower(empty, money), []);
});

test("first visit: the baseline is empty and the current prices are stored", () => {
  const { baseline, next } = rollSnapshots(null, NOW, { TCS: 100 });
  assert.equal(baseline, null);
  assert.deepEqual(next.current, { at: NOW, prices: { TCS: 100 } });
});

test("a reload within 30 minutes keeps the previous baseline", () => {
  const first = rollSnapshots({ baseline: { at: NOW - 48 * HOUR, prices: { TCS: 90 } }, current: { at: NOW - 10 * 60_000, prices: { TCS: 99 } } }, NOW, { TCS: 100 });
  assert.equal(first.baseline?.prices.TCS, 90);
  assert.equal(first.next.current?.prices.TCS, 100);
});

test("a visit after 30 minutes makes the previous visit the baseline", () => {
  const { baseline } = rollSnapshots({ baseline: null, current: { at: NOW - SAME_VISIT_MS - 1, prices: { TCS: 95 } } }, NOW, { TCS: 100 });
  assert.equal(baseline?.prices.TCS, 95);
});

test("stored snapshots that aren't valid JSON or the right shape are ignored", () => {
  assert.equal(parseStoredSnapshots("{oops"), null);
  assert.deepEqual(parseStoredSnapshots(JSON.stringify({ baseline: 3, current: { at: 1, prices: {} } })), { baseline: null, current: { at: 1, prices: {} } });
});

test("a 2%+ change since the last visit beats the day move for the same stock", () => {
  const items = buildWatchtower(
    {
      ...empty,
      baseline: { at: NOW - 24 * HOUR, prices: { TCS: 100, INFY: 100 } },
      quotes: [
        { symbol: "TCS", price: 104, changePercent: 3.5, currency: "INR" },
        { symbol: "INFY", price: 100.5, changePercent: -3.2, currency: "INR" },
        { symbol: "HDFC", price: 50, changePercent: 1, currency: "INR" },
      ],
    },
    money
  );
  assert.deepEqual(
    items.map((i) => [i.id, i.title, i.isNew]),
    [
      ["visit:TCS", "TCS is up 4.00% since your last visit", true],
      ["day:INFY", "INFY fell 3.20% in the latest session", false],
    ]
  );
  assert.equal(items[0].detail, "INR 100.00 → INR 104.00");
});

test("alerts and news since the last visit are marked new and sorted first", () => {
  const items = buildWatchtower(
    {
      ...empty,
      baseline: { at: NOW - 5 * HOUR, prices: {} },
      notifications: [
        { id: "n1", kind: "price_alert", title: "TCS crossed ₹4,000", body: null, link: "/stock/TCS", createdAt: new Date(NOW - HOUR).toISOString() },
        { id: "n2", kind: "price_alert", title: "Old alert", body: null, link: "javascript:alert(1)", createdAt: new Date(NOW - 10 * HOUR).toISOString() },
      ],
      news: [
        { id: "a", title: "TCS board meeting", url: "https://x/a", sourceName: "NSE filings", publishedAt: new Date(NOW - 2 * HOUR).toISOString(), symbols: ["TCS"] },
        { id: "b", title: "TCS board meeting", url: "https://x/b", sourceName: "Dup", publishedAt: new Date(NOW - 2 * HOUR).toISOString(), symbols: ["TCS"] },
        { id: "c", title: "Very old", url: "https://x/c", sourceName: "NSE", publishedAt: new Date(NOW - 5 * 86_400_000).toISOString(), symbols: ["TCS"] },
      ],
    },
    money
  );
  assert.deepEqual(
    items.map((i) => [i.id, i.isNew]),
    [
      ["alert:n1", true],
      ["news:a", true],
      ["alert:n2", false],
    ]
  );
  // A notification link that isn't a local path falls back to /alerts.
  assert.equal(items[2].href, "/alerts");
});

test("events come only from verified dates", () => {
  const items = buildWatchtower(
    {
      ...empty,
      earnings: [{ symbol: "AAPL", date: "2026-10-29", hour: "amc" }],
      ipos: [
        { id: "x", name: "Core4 IPO", section: "open", openDate: "2026-10-23", closeDate: "2026-10-27" },
        { id: "y", name: "No Dates IPO", section: "upcoming", openDate: null, closeDate: null },
      ],
    },
    money
  );
  assert.deepEqual(
    items.map((i) => i.title),
    ["AAPL reports earnings on 2026-10-29 after the close", "Core4 IPO is open until 2026-10-27"]
  );
});

test("a followed stock on NSE's F&O ban list shows as an event with the trade date", () => {
  const items = buildWatchtower({ ...empty, foBan: { tradeDate: "2026-10-26", symbols: ["SAIL", "KAYNES"] } }, money);
  assert.deepEqual(
    items.map((i) => [i.kind, i.title, i.href]),
    [
      ["event", "SAIL is in the F&O ban for 2026-10-26", "/stock/SAIL"],
      ["event", "KAYNES is in the F&O ban for 2026-10-26", "/stock/KAYNES"],
    ]
  );
});
