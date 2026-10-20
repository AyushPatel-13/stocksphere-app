import { test } from "node:test";
import assert from "node:assert/strict";

import { runBacktest, sma, type Bar } from "../backtest";
import { analysePortfolio } from "../portfolio";
import { EMPTY_CRITERIA, applyScreen, position52w, sortScreen } from "../screener";
import { emptyRow, type WatchlistRow } from "../../services/watchlistRows";
import { getEarningsCalendar, parseEarnings } from "../../services/earningsCalendar";
import { GET as earningsRoute } from "@/app/api/events/earnings/route";

/* ------------------------------------------------------------ screener */

const row = (symbol: string, price: number | null, changePercent: number | null, low: number | null, high: number | null, volume: number | null = 1000, market: "india" | "us" = "india") => ({
  ...emptyRow(symbol),
  price,
  changePercent,
  fiftyTwoWeekLow: low,
  fiftyTwoWeekHigh: high,
  volume,
  market,
} satisfies WatchlistRow & { market: "india" | "us" });

const universe = [
  row("UP", 100, 4, 50, 102),
  row("DOWN", 60, -3.5, 58, 120),
  row("FLAT", 80, 0.2, 40, 160, 10),
  row("NOPRICE", null, 5, 1, 2),
  row("NOHIGH", 90, 1, null, null),
  row("AAPL", 340, 1.5, 240, 350, 5000, "us"),
];

test("screens explain why each stock matched", () => {
  const gainers = applyScreen(universe, { ...EMPTY_CRITERIA, minChangePct: 1 });
  assert.deepEqual(gainers.map((r) => r.symbol).sort(), ["AAPL", "NOHIGH", "UP"]);
  assert.match(gainers.find((r) => r.symbol === "UP")!.reasons[0], /day change \+4\.00% ≥ 1%/);

  const nearHigh = applyScreen(universe, { ...EMPTY_CRITERIA, withinOfHighPct: 5 });
  assert.deepEqual(nearHigh.map((r) => r.symbol), ["UP", "AAPL"]);
  assert.match(nearHigh[0].reasons[0], /1\.96% below its 52-week high/);

  const nearLow = applyScreen(universe, { ...EMPTY_CRITERIA, withinOfLowPct: 5 });
  assert.deepEqual(nearLow.map((r) => r.symbol), ["DOWN"]);

  assert.deepEqual(applyScreen(universe, EMPTY_CRITERIA, true).map((r) => r.symbol), ["UP", "DOWN"]);
  assert.deepEqual(applyScreen(universe, { ...EMPTY_CRITERIA, market: "us" }).map((r) => r.symbol), ["AAPL"]);
  assert.deepEqual(applyScreen(universe, { ...EMPTY_CRITERIA, minVolume: 1000 }).map((r) => r.symbol).sort(), ["AAPL", "DOWN", "NOHIGH", "UP"]);
});

test("a missing value never passes a filter that needs it, and unpriced stocks are dropped", () => {
  const all = applyScreen(universe, EMPTY_CRITERIA);
  assert.equal(all.some((r) => r.symbol === "NOPRICE"), false);
  assert.equal(applyScreen(universe, { ...EMPTY_CRITERIA, withinOfHighPct: 50 }).some((r) => r.symbol === "NOHIGH"), false);
  assert.equal(position52w(row("X", 75, 0, 50, 100)), 50);
  assert.equal(position52w(row("X", 75, 0, null, 100)), null);
  assert.deepEqual(sortScreen(all, "change", true).map((r) => r.symbol).slice(0, 2), ["UP", "AAPL"]);
});

/* ------------------------------------------------------------ portfolio */

test("allocation, concentration and effective holdings per currency", () => {
  const [inr, usd] = analysePortfolio([
    { symbol: "TCS", currency: "INR", current: 6000, invested: 5000 },
    { symbol: "INFY", currency: "INR", current: 3000, invested: 3500 },
    { symbol: "HDFC", currency: "INR", current: 1000, invested: 1000 },
    { symbol: "AAPL", currency: "USD", current: 500, invested: 400 },
  ]);
  assert.equal(inr.total, 10000);
  assert.deepEqual(inr.allocations.map((a) => [a.symbol, a.weightPct]), [["TCS", 60], ["INFY", 30], ["HDFC", 10]]);
  assert.equal(inr.effectiveHoldings, 2.2); // 1 / (0.36 + 0.09 + 0.01)
  assert.equal(inr.concentration, "high");
  assert.deepEqual([inr.winners, inr.losers], [1, 1]);
  assert.equal(inr.best?.symbol, "TCS");
  assert.equal(inr.worst?.symbol, "INFY");
  assert.equal(usd.concentration, "single");
  assert.equal(usd.total, 500);
});

/* ------------------------------------------------------------ backtest */

const DAY = 86_400_000;
const bars = (closes: number[]): Bar[] => closes.map((c, i) => ({ t: i * DAY, c }));

test("simple moving average", () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
});

test("buy and hold matches the price change less the entry cost", () => {
  const result = runBacktest(bars([100, 110, 120]), { kind: "buy_hold" }, 0);
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.totalReturnPct, 20);
  assert.equal(result.buyHoldReturnPct, 20);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].open, true);

  const withCost = runBacktest(bars([100, 110, 120]), { kind: "buy_hold" }, 1);
  assert.equal("error" in withCost ? null : withCost.totalReturnPct, 18.8); // 1.2 × 0.99 − 1
});

test("signals act on the next bar: no look-ahead", () => {
  // Price above its 2-bar average from bar 2 (close 12 > 11) → buy at bar 3's close (13).
  const result = runBacktest(bars([10, 10, 12, 13, 9, 8]), { kind: "above_sma", period: 2 }, 0);
  if ("error" in result) throw new Error(result.error);
  const first = result.trades[0];
  assert.equal(first.entryT, 3 * DAY);
  assert.equal(first.entryPrice, 13);
  // Bar 4 closes 9 < 11 → signal out, sold at bar 5's close (8).
  assert.equal(first.exitPrice, 8);
  assert.equal(first.returnPct, -38.46);
  assert.equal(result.maxDrawdownPct, 38.46);
  assert.equal(result.winRatePct, 0);
});

test("backtest refusals", () => {
  assert.match((runBacktest(bars([1, 2]), { kind: "sma_cross", fast: 50, slow: 20 }) as { error: string }).error, /fast < slow/);
  assert.match((runBacktest(bars([1, 2, 3]), { kind: "sma_cross", fast: 5, slow: 20 }) as { error: string }).error, /Not enough history/);
  assert.match((runBacktest(bars([1, 2, 3]), { kind: "above_sma", period: 500 }) as { error: string }).error, /period/);
  assert.match((runBacktest(bars([1, 2, 3]), { kind: "buy_hold" }, -1) as { error: string }).error, /Cost/);
});

/* ------------------------------------------------------------ earnings */

test("earnings rows are parsed strictly and sorted", () => {
  const events = parseEarnings({
    earningsCalendar: [
      { symbol: "msft", date: "2026-10-22", hour: "amc", quarter: 1, year: 2027, epsEstimate: 3.1, revenueEstimate: 70e9 },
      { symbol: "AAPL", date: "2026-10-21", hour: "weird", epsEstimate: "n/a" },
      { symbol: "", date: "2026-10-21" },
      { symbol: "BAD SYMBOL", date: "2026-10-21" },
      { symbol: "GOOG", date: "tomorrow" },
    ],
  });
  assert.deepEqual(events.map((e) => [e.symbol, e.date, e.hour, e.epsEstimate]), [["AAPL", "2026-10-21", null, null], ["MSFT", "2026-10-22", "amc", 3.1]]);
  assert.deepEqual(parseEarnings(null), []);
});

test("the calendar is unavailable without a key or when the provider fails", async () => {
  assert.equal(await getEarningsCalendar("2026-01-01", "2026-01-02", fetch, undefined), null);
  const failing = (async () => new Response("no", { status: 429 })) as typeof fetch;
  assert.equal(await getEarningsCalendar("2026-01-03", "2026-01-04", failing, "k"), null);
});

test("GET /api/events/earnings validates days and reports outages", async () => {
  const now = () => Date.parse("2026-10-20T00:00:00Z");
  const ok = await earningsRoute(new Request("http://x?days=7"), undefined, async (from, to) => {
    assert.deepEqual([from, to], ["2026-10-20", "2026-10-27"]);
    return [];
  }, now);
  assert.equal(ok.status, 200);
  assert.equal((await earningsRoute(new Request("http://x?days=99"), undefined, async () => [], now)).status, 400);
  assert.equal((await earningsRoute(new Request("http://x"), undefined, async () => null, now)).status, 503);
});

import { holdingsCsv } from "@/components/Portfolio/PortfolioAnalytics";

test("holdings export as CSV, leaving unpriced values blank and quoting where needed", () => {
  const csv = holdingsCsv([
    { id: "1", symbol: "TCS", quantity: 2, avgPrice: 2400, invested: 4800, quote: { price: 2460, change: -4, changePercent: -0.2, volume: null, currency: "INR" }, current: 4920, pnl: 120, pnlPercent: 2.5, dayChange: -8 },
    { id: "2", symbol: "M&M,X", quantity: 1, avgPrice: 10, invested: 10, quote: null, current: null, pnl: null, pnlPercent: null, dayChange: null },
  ]);
  assert.equal(
    csv,
    ["symbol,quantity,avg_price,invested,currency,current_value,pnl,pnl_pct", "TCS,2,2400,4800,INR,4920,120,2.5", '"M&M,X",1,10,10,,,,'].join("\n")
  );
});
