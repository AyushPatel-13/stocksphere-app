import { test } from "node:test";
import assert from "node:assert/strict";

import { ema, rsi, sma } from "../indicators";
import { formatCompactVolume, formatValue } from "../format";
import { parseChartSeries } from "@/lib/apis/yahooChart";
import { createHistoryLoader, resolveAsset } from "@/lib/services/history";
import { createBoardLoader } from "@/lib/services/assetBoard";
import { GET as historyRoute } from "@/app/api/history/route";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test("SMA averages the last N closes and leaves the warm-up as gaps", () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test("EMA starts at the SMA and then weights recent prices more", () => {
  const out = ema([1, 2, 3, 4, 5], 3);
  assert.deepEqual(out.slice(0, 2), [null, null]);
  assert.equal(out[2], 2);
  assert.ok(close(out[3]!, 3));
  assert.ok(close(out[4]!, 4));
});

test("RSI: 100 in a straight rise, 0 in a straight fall, 50 when flat", () => {
  const up = Array.from({ length: 20 }, (_, i) => i + 1);
  const down = [...up].reverse();
  const flat = Array(20).fill(5);

  assert.equal(rsi(up)[19], 100);
  assert.equal(rsi(down)[19], 0);
  assert.equal(rsi(flat)[19], 50);
  assert.equal(rsi(up)[13], null);
  assert.deepEqual(rsi([1, 2, 3]), [null, null, null]);
});

test("values: rupees for INR, dollars for USD, points for indices, % for yields", () => {
  assert.equal(formatValue(245610.5, "currency", "INR"), "₹2,45,610.50");
  assert.equal(formatValue(763.25, "currency", "USD"), "$763.25");
  assert.equal(formatValue(23012.05, "points", "INR"), "23,012.05");
  assert.equal(formatValue(5.098, "percent", "USD"), "5.098%");
  assert.equal(formatValue(null, "currency", "INR"), "—");
  // Tiny crypto prices keep their significant digits.
  assert.match(formatValue(0.0004754576, "currency", "INR"), /0\.0004754/);
  assert.equal(formatCompactVolume(12_345_678, true), "1.23Cr");
  assert.equal(formatCompactVolume(456_000, true), "4.56L");
  assert.equal(formatCompactVolume(1_200_000, false), "1.2M");
});

test("chart series: candles with no close are dropped, meta carries currency and 52-week range", () => {
  const series = parseChartSeries({
    chart: {
      result: [
        {
          meta: { currency: "INR", shortName: "TCS", fiftyTwoWeekHigh: 4000, fiftyTwoWeekLow: 2300, regularMarketPrice: 2456 },
          timestamp: [1, 2, 3],
          indicators: { quote: [{ open: [1, 2, 3], high: [1, 2, 3], low: [1, 2, 3], close: [10, null, 12], volume: [100, 0, 300] }] },
        },
      ],
    },
  });

  assert.equal(series?.currency, "INR");
  assert.equal(series?.fiftyTwoWeekHigh, 4000);
  assert.deepEqual(series?.candles.map((c) => [c.t, c.c]), [[1000, 10], [3000, 12]]);
});

test("assets resolve to the right source symbol and currency", () => {
  assert.deepEqual(
    [resolveAsset("stock", "TCS")?.yahoo, resolveAsset("stock", "TCS")?.currency],
    ["TCS.NS", "INR"]
  );
  assert.equal(resolveAsset("stock", "AAPL")?.currency, "USD");
  assert.equal(resolveAsset("stock", "NIFTYBEES")?.yahoo, "NIFTYBEES.NS");
  assert.equal(resolveAsset("index", "NIFTY")?.yahoo, "^NSEI");
  assert.equal(resolveAsset("index", "NIFTY")?.unit, "points");
  assert.equal(resolveAsset("index", "SPX")?.yahoo, "^GSPC");
  assert.equal(resolveAsset("crypto", "btc", "USD")?.yahoo, "BTC-USD");
  assert.equal(resolveAsset("crypto", "BTC", "INR")?.currency, "INR");
  assert.equal(resolveAsset("bond", "US10Y")?.unit, "percent");
  assert.equal(resolveAsset("index", "UNKNOWN"), null);
  assert.equal(resolveAsset("stock", "<script>"), null);
});

test("history: Yahoo first, Upstox daily candles as the fallback for Indian stocks, cached", async () => {
  let yahooCalls = 0;
  const load = createHistoryLoader({
    getYahooSeries: async () => {
      yahooCalls++;
      return null;
    },
    getUpstoxDaily: async () => [
      { t: 1, o: 1, h: 2, l: 1, c: 2, v: 10 },
      { t: 2, o: 2, h: 3, l: 2, c: 3, v: 20 },
    ],
    now: () => 0,
  });

  const tcs = resolveAsset("stock", "TCS")!;
  const first = await load(tcs, "1y");
  assert.equal(first?.source, "Upstox");
  assert.equal(first?.currency, "INR");

  await load(tcs, "1y");
  assert.equal(yahooCalls, 1);

  // Intraday ranges have no daily fallback.
  assert.equal(await load(tcs, "1d"), null);
  // US stocks have no Upstox fallback.
  assert.equal(await load(resolveAsset("stock", "AAPL")!, "1y"), null);
});

test("/api/history validates input and returns 404 when there is no history", async () => {
  assert.equal((await historyRoute(new Request("http://x/api/history?type=stock&symbol=TCS&range=7y"))).status, 400);
  assert.equal((await historyRoute(new Request("http://x/api/history?type=index&symbol=NOPE&range=1y"))).status, 400);

  const none = await historyRoute(
    new Request("http://x/api/history?type=stock&symbol=AAPL&range=1y"),
    undefined,
    async () => null
  );
  assert.equal(none.status, 404);
});

test("hub boards keep unpriced entries as null and don't cache an outage", async () => {
  let calls = 0;
  const load = createBoardLoader(async () => {
    calls++;
    return calls === 1 ? null : { "SPY": { price: 700, change: 5, changePercent: 0.7, open: null, high: null, low: null, previousClose: 695, currency: "USD", marketTime: null } };
  }, () => 0);

  const down = await load("etf", "INR");
  assert.ok(down.items.every((item) => item.price === null));

  const up = await load("etf", "INR");
  assert.equal(up.items.find((item) => item.symbol === "SPY")?.price, 700);
  assert.equal(up.items.find((item) => item.symbol === "NIFTYBEES")?.price, null);

  await load("etf", "INR");
  assert.equal(calls, 2);
});

test("chart series carry the exchange's regular session for a full-day 1D axis", () => {
  const series = parseChartSeries({
    chart: {
      result: [
        {
          meta: { currency: "INR", currentTradingPeriod: { regular: { start: 1792388700, end: 1792411200 } } },
          timestamp: [1792388700],
          indicators: { quote: [{ close: [22900] }] },
        },
      ],
    },
  });
  assert.equal(series?.sessionStart, 1792388700 * 1000);
  assert.equal((series!.sessionEnd! - series!.sessionStart!) / 60_000, 375); // 09:15–15:30 IST
});

test("3Y asks Yahoo for five years and keeps only the last three", async () => {
  const now = Date.parse("2026-10-19T00:00:00Z");
  const year = 365 * 86_400_000;
  let asked = "";
  const load = createHistoryLoader({
    getYahooSeries: async (_symbol, range, interval) => {
      asked = `${range}/${interval}`;
      return {
        name: null, currency: "INR", exchangeTimezone: null, previousClose: null,
        fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, regularMarketPrice: null, marketTime: null,
        sessionStart: null, sessionEnd: null,
        candles: [now - 4 * year, now - 2 * year, now - 1000].map((t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 })),
      };
    },
    getUpstoxDaily: async () => null,
    now: () => now,
  });

  const history = await load(resolveAsset("index", "NIFTY")!, "3y");
  assert.equal(asked, "5y/1wk");
  assert.equal(history?.candles.length, 2);
});

// --- pivots ------------------------------------------------------------------

import { classicPivots, previousSession } from "../pivots";

test("classic pivots follow the floor-trader formulas", () => {
  const p = classicPivots(110, 90, 100);
  assert.equal(p.pivot, 100);
  assert.equal(p.r1, 110);
  assert.equal(p.s1, 90);
  assert.equal(p.r2, 120);
  assert.equal(p.s2, 80);
  assert.equal(p.r3, 130);
  assert.equal(p.s3, 70);
  assert.ok(p.s3 < p.s2 && p.s2 < p.s1 && p.s1 < p.pivot && p.pivot < p.r1 && p.r1 < p.r2 && p.r2 < p.r3);
});

test("the previous session is the last daily candle before today's open", () => {
  const day = 86_400_000;
  const today = 10 * day;
  const candles = [
    { t: 8 * day, o: 1, h: 5, l: 1, c: 4, v: 0 },
    { t: 9 * day, o: 4, h: 9, l: 3, c: 8, v: 0 },
    { t: today, o: 8, h: 10, l: 7, c: 9, v: 0 }, // today, in progress
  ];
  assert.deepEqual(previousSession(candles, today), { high: 9, low: 3, close: 8 });
  // Without a session time, the newest candle is treated as today's.
  assert.deepEqual(previousSession(candles, null), { high: 9, low: 3, close: 8 });
  assert.equal(previousSession([], today), null);
});

// --- index overview ----------------------------------------------------------

import { downsample, toOverviewRow } from "@/lib/services/indexOverview";

test("sparklines are thinned evenly and keep the first and last points", () => {
  const values = Array.from({ length: 300 }, (_, i) => i);
  const thin = downsample(values, 48);
  assert.equal(thin.length, 48);
  assert.equal(thin[0], 0);
  assert.equal(thin.at(-1), 299);
  assert.deepEqual(downsample([1, 2, 3], 48), [1, 2, 3]);
});

test("an overview row takes its day change from the previous close", () => {
  const row = toOverviewRow(
    { name: "NIFTY 50", symbol: "NIFTY", instrumentKey: "NSE_INDEX|Nifty 50", category: "indian" },
    {
      type: "index", symbol: "NIFTY", name: "NIFTY 50", unit: "points", currency: "INR", range: "1d", interval: "1m",
      candles: [{ t: 1, o: null, h: null, l: null, c: 101, v: null }, { t: 2, o: null, h: null, l: null, c: 99, v: null }],
      previousClose: 100, fiftyTwoWeekHigh: 120, fiftyTwoWeekLow: 80, marketTime: null,
      sessionStart: null, sessionEnd: null, source: "Yahoo",
    }
  );
  assert.equal(row.price, 99);
  assert.equal(row.change, -1);
  assert.equal(row.changePercent, -1);
  assert.deepEqual(row.spark, [101, 99]);

  const empty = toOverviewRow({ name: "DAX", symbol: "DAX", yahooSymbol: "^GDAXI", category: "global" }, null);
  assert.equal(empty.price, null);
  assert.deepEqual(empty.spark, []);
});
