import { test } from "node:test";
import assert from "node:assert/strict";

import {
  METRICS,
  METRIC_BY_ID,
  dailyVolatility,
  extendedHoursChange,
  intradayChange,
  localDate,
  metricUnavailableReason,
  perfTarget,
  performance,
  priceGap,
  relativeVolume,
  shiftDate,
  type MinuteSeries,
} from "../heatmapMetrics";
import { NO_DATA_COLOR, colorFor, divergingStops } from "../heatmap";
import { buildView, formatExchangeTime, formatMetric, legendFor, metricValue, searchTiles, sizeValue } from "../heatmapView";
import type { HeatmapTile } from "../../services/heatmap";

/* ------------------------------------------------------------ dates */

test("localDate uses the exchange's zone, not UTC", () => {
  // 20:00 UTC on 19 Oct is 01:30 on 20 Oct in India, 16:00 on 19 Oct in New York.
  const t = Date.UTC(2026, 9, 19, 20, 0);
  assert.equal(localDate(t, "Asia/Kolkata"), "2026-10-20");
  assert.equal(localDate(t, "America/New_York"), "2026-10-19");
});

test("shiftDate: calendar days, month-end clamping, leap years", () => {
  assert.equal(shiftDate("2026-10-19", { days: 7 }), "2026-10-12");
  assert.equal(shiftDate("2026-03-31", { months: 1 }), "2026-02-28");
  assert.equal(shiftDate("2028-03-31", { months: 1 }), "2028-02-29");
  assert.equal(shiftDate("2026-01-15", { months: 3 }), "2025-10-15");
  assert.equal(shiftDate("2028-02-29", { years: 1 }), "2027-02-28");
  assert.equal(perfTarget("2026-10-19", "YTD"), "2025-12-31");
  assert.equal(perfTarget("2026-01-02", "YTD"), "2025-12-31");
});

/* ------------------------------------------------------------ performance */

const IST_OPEN = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 3, 45);

test("performance: base is the last close on or before the target; holidays/weekends fall back", () => {
  // Fri 9 Oct, Mon 12 Oct is a holiday (no bar), Tue 13 … Mon 19 Oct.
  const times = [IST_OPEN(2026, 10, 9), IST_OPEN(2026, 10, 13), IST_OPEN(2026, 10, 16), IST_OPEN(2026, 10, 19)];
  const closes = [100, 104, 108, 110];
  const p = performance({ times, closes, timeZone: "Asia/Kolkata" }, "1W")!;
  // Target 12 Oct has no bar → the 9 Oct close is the base.
  assert.equal(p.fromDate, "2026-10-09");
  assert.equal(p.toDate, "2026-10-19");
  assert.equal(p.value, 10);
});

test("performance: null when history doesn't reach the period, never 0", () => {
  const times = [IST_OPEN(2026, 10, 15), IST_OPEN(2026, 10, 16), IST_OPEN(2026, 10, 19)];
  assert.equal(performance({ times, closes: [1, 2, 3], timeZone: "Asia/Kolkata" }, "1M"), null);
  assert.equal(performance({ times, closes: [1, 2, 3], timeZone: null }, "1W"), null);
  assert.equal(performance({ times: [IST_OPEN(2026, 10, 19)], closes: [1], timeZone: "Asia/Kolkata" }, "1W"), null);
});

test("performance YTD uses last year's final close", () => {
  const times = [IST_OPEN(2025, 12, 30), IST_OPEN(2025, 12, 31), IST_OPEN(2026, 1, 1), IST_OPEN(2026, 10, 19)];
  const p = performance({ times, closes: [90, 100, 101, 125], timeZone: "Asia/Kolkata" }, "YTD")!;
  assert.equal(p.fromDate, "2025-12-31");
  assert.equal(p.value, 25);
});

/* ------------------------------------------------------------ volatility */

test("dailyVolatility: sample std-dev of 20 returns; a session in progress is excluded", () => {
  const n = 22;
  const times = Array.from({ length: n }, (_, i) => IST_OPEN(2026, 9, 1) + i * 86_400_000);
  // Alternating +1% / −1% moves: std-dev of returns ≈ 1.
  const closes = [100];
  for (let i = 1; i < n; i++) closes.push(closes[i - 1] * (i % 2 ? 1.01 : 0.99));
  const series = { times, closes, timeZone: "Asia/Kolkata" };
  const done = dailyVolatility(series, times[n - 1] + 10 * 3_600_000, null)!;
  assert.ok(Math.abs(done - 1.026) < 0.01, `got ${done}`);
  // Mid-session: the latest bar is today's, so it's dropped; 21 closes remain → still computable.
  const live = dailyVolatility(series, times[n - 1] + 3_600_000, { start: times[n - 1], end: times[n - 1] + 6.25 * 3_600_000 });
  assert.ok(live !== null);
  assert.equal(dailyVolatility({ times: times.slice(0, 10), closes: closes.slice(0, 10), timeZone: "Asia/Kolkata" }, 0, null), null);
});

/* ------------------------------------------------------------ intraday */

const START = Date.UTC(2026, 9, 19, 13, 30); // 09:30 ET
function minutes(count: number, from = START, price = (i: number) => 100 + i * 0.01): { times: number[]; closes: number[] } {
  return { times: Array.from({ length: count }, (_, i) => from + i * 60_000), closes: Array.from({ length: count }, (_, i) => price(i)) };
}

test("intradayChange: 60 minutes back within the regular session, from 1-minute bars", () => {
  const { times, closes } = minutes(120);
  const series: MinuteSeries = { times, closes, previousClose: 99, periods: { pre: null, regular: { start: START, end: START + 390 * 60_000 }, post: null } };
  const r = intradayChange(series, 60)!;
  // Last bar i=119 closes at 09:30+120m; reference is the bar closing at +60m (i=59).
  assert.equal(r.toTime, START + 120 * 60_000);
  assert.equal(r.fromTime, START + 60 * 60_000);
  assert.ok(Math.abs(r.value - ((101.19 - 100.59) / 100.59) * 100) < 1e-9);
  assert.equal(intradayChange(series, 240), null, "session too young for 4h");
});

test("intradayChange: null with no regular-session bars (e.g. pre-market only)", () => {
  const { times, closes } = minutes(30, START - 60 * 60_000);
  const series: MinuteSeries = { times, closes, previousClose: 99, periods: { pre: { start: START - 330 * 60_000, end: START }, regular: { start: START, end: START + 390 * 60_000 }, post: null } };
  assert.equal(intradayChange(series, 60), null);
});

test("extendedHoursChange: pre vs previous close, post vs the regular close; null without bars", () => {
  const pre = { start: START - 330 * 60_000, end: START };
  const regular = { start: START, end: START + 390 * 60_000 };
  const post = { start: regular.end, end: regular.end + 240 * 60_000 };
  const s: MinuteSeries = {
    times: [START - 10 * 60_000, START, START + 389 * 60_000, regular.end + 5 * 60_000],
    closes: [101, 102, 110, 99],
    previousClose: 100,
    periods: { pre, regular, post },
  };
  assert.equal(extendedHoursChange(s, "pre")!.value, 1);
  assert.equal(extendedHoursChange(s, "post")!.value, -10);
  assert.equal(extendedHoursChange({ ...s, periods: { pre: null, regular, post: null } }, "pre"), null);
  assert.equal(extendedHoursChange({ ...s, previousClose: null }, "pre"), null);
});

test("priceGap and relativeVolume reject missing inputs instead of reading them as zero", () => {
  assert.equal(priceGap(102, 100), 2);
  assert.equal(priceGap(null, 100), null);
  assert.equal(priceGap(0, 100), null);
  const bars = Array.from({ length: 21 }, (_, i) => ({ t: i, v: i === 20 ? 150 : 100 }));
  assert.equal(relativeVolume(bars)!.value, 1.5);
  assert.equal(relativeVolume(bars.slice(1)), null, "fewer than 20 prior sessions");
  assert.equal(relativeVolume(bars.map((b, i) => (i === 3 ? { ...b, v: null } : b))), null);
});

/* ------------------------------------------------------------ availability */

test("metricUnavailableReason: pre/post-market US only; relative volume capped by universe size", () => {
  const pre = METRIC_BY_ID.get("premarket")!;
  assert.ok(metricUnavailableReason(pre, "India", 50));
  assert.equal(metricUnavailableReason(pre, "US", 20), null);
  const rv = METRIC_BY_ID.get("relvol")!;
  assert.equal(metricUnavailableReason(rv, "India", 100), null);
  assert.ok(metricUnavailableReason(rv, "India", 200));
  assert.equal(new Set(METRICS.map((m) => m.id)).size, METRICS.length);
});

/* ------------------------------------------------------------ view */

const tile = (symbol: string, over: Partial<HeatmapTile> = {}): HeatmapTile => ({
  symbol,
  href: `${symbol}.NS`,
  name: `${symbol} Ltd.`,
  market: "India",
  currency: "INR",
  sector: "IT",
  industry: null,
  price: 100,
  change: 1,
  changePercent: 1,
  open: 99,
  previousClose: 99,
  gap: 0,
  volume: 1000,
  marketCap: 1e12,
  sharesAsOf: "2026-06-30",
  quoteTime: null,
  ...over,
});

test("buildView: sizing selector changes what is sized; unsized and unpriced are listed, not guessed", () => {
  const tiles = [tile("A"), tile("B", { marketCap: null }), tile("C", { volume: 0 }), tile("D", { price: null })];
  const cap = buildView(tiles, "marketCap", "none");
  assert.deepEqual(cap.groups.flatMap((g) => g.items.map((i) => i.id)), ["A", "C"]);
  assert.deepEqual(cap.unsized.map((t) => t.symbol), ["B"]);
  assert.deepEqual(cap.unpriced.map((t) => t.symbol), ["D"]);
  const vol = buildView(tiles, "volume", "none");
  assert.deepEqual(vol.groups.flatMap((g) => g.items.map((i) => i.id)), ["A", "B"]);
  assert.deepEqual(vol.unsized.map((t) => t.symbol), ["C"]);
  const eq = buildView(tiles, "equal", "none");
  assert.equal(eq.groups[0].items.length, 3);
  assert.equal(sizeValue(tile("X", { price: null }), "equal"), null);
});

test("buildView: grouping keeps every stock in its own group; missing classification is 'Unclassified'", () => {
  const tiles = [tile("A", { sector: "IT", marketCap: 3 }), tile("B", { sector: "Banks", marketCap: 5 }), tile("C", { sector: "IT", marketCap: 4 }), tile("D", { sector: null, marketCap: 1 })];
  const v = buildView(tiles, "marketCap", "sector");
  assert.deepEqual(
    v.groups.map((g) => [g.label, g.items.map((i) => i.id)]),
    [
      ["IT", ["A", "C"]],
      ["Banks", ["B"]],
      ["Unclassified", ["D"]],
    ]
  );
  const flat = buildView(tiles, "marketCap", "none");
  assert.equal(flat.groups.length, 1);
});

test("metricValue: base metrics from the tile, others from the batched values; missing stays null", () => {
  const t = tile("A", { changePercent: 2.5, gap: -1 });
  assert.equal(metricValue(t, "chg1d", null)?.value, 2.5);
  assert.equal(metricValue(t, "gap", null)?.value, -1);
  assert.equal(metricValue(t, "perf1w", null), null);
  assert.equal(metricValue(t, "perf1w", { A: { perf1w: { value: 4, from: "a", to: "b" } } })?.value, 4);
  assert.equal(metricValue(tile("A", { changePercent: null }), "chg1d", null), null);
});

test("colour, legend and labels follow the selected metric", () => {
  const perf1y = METRIC_BY_ID.get("perf1y")!;
  const stops = divergingStops(30);
  assert.equal(colorFor(30, stops), "#30cc5a");
  assert.equal(colorFor(-45, stops), "#f63538");
  assert.equal(colorFor(null, stops), NO_DATA_COLOR);
  assert.deepEqual(legendFor(perf1y).map((l) => l.label), ["-30%", "-20%", "-10%", "0%", "+10%", "+20%", "+30%"]);
  assert.deepEqual(legendFor(METRIC_BY_ID.get("relvol")!).map((l) => l.label), ["≤0.5×", "1×", "1.5×", "2×", "≥3×"]);
  assert.equal(formatMetric(1.234, perf1y), "+1.23%");
  assert.equal(formatMetric(1.5, METRIC_BY_ID.get("relvol")!), "1.50×");
  assert.equal(formatMetric(2, METRIC_BY_ID.get("volatility")!), "2.00%");
  assert.equal(formatMetric(null, perf1y), "—");
});

test("searchTiles: exact, then prefix, then contains, then name", () => {
  const tiles = [tile("TCS", { name: "Tata Consultancy" }), tile("TATASTEEL", { name: "Tata Steel" }), tile("HCLTECH", { name: "HCL Technologies" }), tile("TITAN", { name: "Titan Company" })];
  assert.deepEqual(searchTiles(tiles, "tcs").map((t) => t.symbol), ["TCS"]);
  // TATASTEEL: symbol prefix; TITAN: symbol contains; TCS: only its name ("Tata …") matches.
  assert.deepEqual(searchTiles(tiles, "ta").map((t) => t.symbol), ["TATASTEEL", "TITAN", "TCS"]);
  assert.deepEqual(searchTiles(tiles, "technologies").map((t) => t.symbol), ["HCLTECH"]);
  assert.deepEqual(searchTiles(tiles, "  "), []);
});

test("formatExchangeTime labels the exchange zone", () => {
  assert.equal(formatExchangeTime("2026-10-19T09:59:00.000Z", "India"), "19 Oct, 15:29 IST");
  assert.equal(formatExchangeTime("2026-10-19T20:00:00.000Z", "US"), "19 Oct, 16:00 ET");
  assert.equal(formatExchangeTime("2026-10-19 close", "US"), "2026-10-19 close");
  assert.equal(formatExchangeTime(null, "US"), "—");
});
