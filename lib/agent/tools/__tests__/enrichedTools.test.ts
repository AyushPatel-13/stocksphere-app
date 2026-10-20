import { test } from "node:test";
import assert from "node:assert/strict";

import { getEnrichedFinancials, type EnrichDeps } from "../financialsTool";
import { runEarningsTool, earningsTool } from "../earningsTool";
import type { EarningsEvent } from "@/lib/services/earningsCalendar";

function deps(overrides: Partial<EnrichDeps> = {}): EnrichDeps {
  return {
    financials: async () => ({ pe: 18.46, roe: 8.94 }),
    quote: async () => ({ price: 1202, currency: "INR" }),
    yahooSymbol: () => "RELIANCE.NS",
    fundamentals: async () => ({ epsTtm: { value: 55.22, asOf: "2026-06-30" }, sharesOutstanding: { value: 13532472634, asOf: "2026-03-31" }, currency: "INR" }),
    dividends: async () => ({ total12m: 6, count: 1, lastDate: "2026-06-05" }),
    range52w: async () => ({ high: 1611.8, low: 1152.2 }),
    ...overrides,
  };
}

test("financials: provider ratios kept, gaps filled from real data, each with a source", async () => {
  const f = (await getEnrichedFinancials("RELIANCE.NS", deps()))!;
  assert.equal(f.pe, 18.46);
  assert.equal(f.sources.pe, "Upstox");
  assert.equal(f.roe, 8.94);
  assert.equal(f.marketCap, 16266032106068);
  assert.match(f.sources.marketCap!, /Price × shares/);
  assert.equal(f.marketCapDisplay, "₹16.27 L Cr");
  assert.equal(f.eps, 55.22);
  assert.equal(f.dividendYield, 0.5);
  assert.deepEqual([f.week52High, f.week52Low], [1611.8, 1152.2]);
  assert.match(f.sources.week52High!, /Price history/);
  assert.equal(f.currency, "INR");
});

test("financials: a Finnhub market cap (in millions) is never passed through", async () => {
  const f = (await getEnrichedFinancials("AAPL", deps({ financials: async () => ({ marketCap: 5_036_000 }), quote: async () => ({ price: 342.94, currency: "USD" }), fundamentals: async () => null })))!;
  assert.equal(f.marketCap, null);
  assert.equal(f.sources.marketCap, undefined);
});

test("financials: every source failing leaves metrics null, not zero", async () => {
  const fail = async () => {
    throw new Error("down");
  };
  const f = (await getEnrichedFinancials("X.NS", { financials: fail, quote: fail, yahooSymbol: () => null, fundamentals: fail, dividends: fail, range52w: fail }))!;
  assert.ok(Object.entries(f).filter(([k]) => k !== "sources").every(([, v]) => v === null));
  assert.deepEqual(f.sources, {});
});

const event = (symbol: string, epsEstimate: number | null = 1): EarningsEvent => ({
  symbol, date: "2026-10-22", hour: "amc", quarter: 3, year: 2026, epsEstimate, epsActual: null, revenueEstimate: null, revenueActual: null, source: "Finnhub",
});

test("earnings: requested tickers are found or reported missing, Indian suffixes stripped", async () => {
  const asked: (string | null | undefined)[] = [];
  const result = (await runEarningsTool({ symbols: ["aapl", "TCS.NS"], days: 7 }, async (from, to, _f, _k, symbol) => {
    assert.deepEqual([from, to], ["2026-10-20", "2026-10-27"]);
    asked.push(symbol);
    return symbol === "AAPL" ? [event("AAPL")] : [];
  }, Date.parse("2026-10-20T05:00:00Z")))!;
  assert.deepEqual(asked, ["AAPL", "TCS"]);
  assert.deepEqual(result.events.map((e) => e.symbol), ["AAPL"]);
  assert.deepEqual(result.notFound, ["TCS"]);
  assert.match(result.coverage, /Indian results dates are not available/);
});

test("earnings: without tickers, the reports with estimates are listed; outages are failures", async () => {
  const result = (await runEarningsTool({}, async () => [event("A"), event("B", null)]))!;
  assert.deepEqual(result.events.map((e) => e.symbol), ["A"]);
  assert.equal(result.totalInWindow, 2);
  assert.equal(await runEarningsTool({}, async () => null), null);
  assert.equal(earningsTool.argsSchema.safeParse({ days: 60 }).success, false);
});

import { weeklyWindows, getEarningsCalendar } from "@/lib/services/earningsCalendar";

test("earnings calendar: long windows are fetched a week at a time and merged", async () => {
  assert.deepEqual(weeklyWindows("2026-10-20", "2026-11-03"), [["2026-10-20", "2026-10-26"], ["2026-10-27", "2026-11-02"], ["2026-11-03", "2026-11-03"]]);
  const urls: string[] = [];
  const fetcher = (async (url: string) => {
    urls.push(url);
    const from = new URL(url).searchParams.get("from");
    return new Response(JSON.stringify({ earningsCalendar: [{ symbol: "AAPL", date: "2026-11-02" }, { symbol: from === "2026-10-20" ? "MSFT" : "AAPL", date: from === "2026-10-20" ? "2026-10-28" : "2026-11-02" }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const events = (await getEarningsCalendar("2026-10-20", "2026-11-03", fetcher, "k"))!;
  assert.equal(urls.length, 3);
  assert.deepEqual(events.map((e) => e.symbol + "@" + e.date), ["MSFT@2026-10-28", "AAPL@2026-11-02"]);

  const one = (await getEarningsCalendar("2026-10-20", "2026-11-19", fetcher, "k", "aapl"))!;
  assert.match(urls.at(-1)!, /symbol=AAPL/);
  assert.equal(one.length, 1);
});
