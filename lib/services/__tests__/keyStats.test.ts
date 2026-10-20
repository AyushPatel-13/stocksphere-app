import { test } from "node:test";
import assert from "node:assert/strict";

import { getYahooFundamentals, parseDividends, parseFundamentalsTimeseries } from "../../apis/yahooFundamentals";
import { acceptSummary, candidateTitles, getCompanySummary, trimSummary } from "../../apis/wikipedia";
import { buildKeyStats, formatMarketCap } from "../keyStats";

const point = (asOfDate: string, raw: number) => ({ asOfDate, periodType: "TTM", currencyCode: "INR", reportedValue: { raw } });

const timeseries = {
  timeseries: {
    result: [
      { meta: { type: ["trailingDilutedEPS"] }, trailingDilutedEPS: [point("2026-03-31", 54.1), null, point("2026-06-30", 55.22)] },
      { meta: { type: ["quarterlyOrdinarySharesNumber"] }, quarterlyOrdinarySharesNumber: [point("2026-03-31", 13532472634)] },
      { meta: { type: ["annualOrdinarySharesNumber"] }, annualOrdinarySharesNumber: [point("2025-03-31", 13500000000)] },
    ],
  },
};

test("fundamentals: the latest EPS and the most recent share count", () => {
  const f = parseFundamentalsTimeseries(timeseries);
  assert.deepEqual(f.epsTtm, { value: 55.22, asOf: "2026-06-30" });
  assert.deepEqual(f.sharesOutstanding, { value: 13532472634, asOf: "2026-03-31" });
  assert.equal(f.currency, "INR");
  assert.deepEqual(parseFundamentalsTimeseries({}), { epsTtm: null, sharesOutstanding: null, currency: null });
});

test("dividends: only those paid in the last 12 months count", () => {
  const now = Date.parse("2026-10-20T00:00:00Z");
  const day = (iso: string) => Date.parse(iso) / 1000;
  const body = {
    chart: {
      result: [
        {
          events: {
            dividends: {
              a: { amount: 12, date: day("2026-07-15T00:00:00Z") },
              b: { amount: 31, date: day("2026-01-20T00:00:00Z") },
              c: { amount: 99, date: day("2025-09-01T00:00:00Z") },
              d: { amount: -1, date: day("2026-02-01T00:00:00Z") },
            },
          },
        },
      ],
    },
  };
  assert.deepEqual(parseDividends(body, now), { total12m: 43, count: 2, lastDate: "2026-07-15" });
  assert.deepEqual(parseDividends({ chart: { result: [{}] } }, now), { total12m: 0, count: 0, lastDate: null });
  assert.equal(parseDividends({}, now), null);
});

test("a failed Yahoo request is not cached", async () => {
  let calls = 0;
  const failing = (async () => {
    calls++;
    return new Response("no", { status: 500 });
  }) as typeof fetch;
  assert.equal(await getYahooFundamentals("TEST.NS", failing, 1), null);
  assert.equal(await getYahooFundamentals("TEST.NS", failing, 2), null);
  assert.equal(calls, 2);
});

test("key stats: market cap from price × shares, provider figures first, then Yahoo", () => {
  const yahoo = parseFundamentalsTimeseries(timeseries);
  const stats = buildKeyStats({
    price: 1202,
    provider: { pe: 18.46, eps: null, dividendYield: null },
    providerName: "Upstox",
    yahoo,
    dividends: { total12m: 6, count: 1, lastDate: "2026-06-05" },
  });
  assert.equal(stats.marketCap?.value, 16266032106068);
  assert.match(stats.marketCap!.source, /shares as of 2026-03-31/);
  assert.deepEqual(stats.pe, { value: 18.46, source: "Upstox" });
  assert.equal(stats.eps?.value, 55.22);
  assert.equal(stats.dividendYield?.value, 0.5);

  const noProvider = buildKeyStats({ price: 100, provider: null, providerName: "Upstox", yahoo: { epsTtm: { value: 5, asOf: "x" }, sharesOutstanding: null, currency: null }, dividends: { total12m: 0, count: 0, lastDate: null } });
  assert.deepEqual(noProvider.pe, { value: 20, source: "Price ÷ EPS (TTM)" });
  assert.equal(noProvider.marketCap, null);
  assert.equal(noProvider.dividendYield?.value, 0);
  assert.match(noProvider.dividendYield!.source, /No dividends/);

  const nothing = buildKeyStats({ price: null, provider: null, providerName: "Upstox", yahoo: null, dividends: null });
  assert.deepEqual(nothing, { marketCap: null, eps: null, pe: null, dividendYield: null });
});

test("market cap formatting: lakh crore and crore for rupees, T/B/M otherwise", () => {
  assert.equal(formatMarketCap(16266032106068, "INR"), "₹16.27 L Cr");
  assert.equal(formatMarketCap(45_000_000_000, "INR"), "₹4,500 Cr");
  assert.equal(formatMarketCap(5_036_000_000_000, "USD"), "$5.04T");
  assert.equal(formatMarketCap(12_300_000_000, "USD"), "$12.30B");
  assert.equal(formatMarketCap(null, "INR"), "N/A");
});

/* ------------------------------------------------------------ wikipedia */

const page = (overrides: Record<string, unknown> = {}) => ({
  type: "standard",
  title: "Reliance Industries",
  description: "Indian multinational conglomerate",
  extract: "Reliance Industries Limited is an Indian multinational conglomerate headquartered in Mumbai.",
  content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Reliance_Industries" } },
  ...overrides,
});

test("wikipedia: only a normal article about this company is accepted", () => {
  assert.deepEqual(candidateTitles("Reliance Industries Limited"), ["Reliance Industries Limited", "Reliance Industries"]);
  assert.equal(acceptSummary(page(), "Reliance Industries Limited")?.url, "https://en.wikipedia.org/wiki/Reliance_Industries");
  assert.equal(acceptSummary(page({ type: "disambiguation" }), "Reliance Industries Limited"), null);
  assert.equal(acceptSummary(page({ title: "Mumbai", description: "city", extract: "Mumbai is a city." }), "Reliance Industries Limited"), null);
  assert.equal(acceptSummary(page({ title: "Tata Group" }), "Reliance Industries Limited"), null);
  assert.equal(acceptSummary(page({ content_urls: { desktop: { page: "https://evil.example/x" } } }), "Reliance Industries Limited"), null);
  assert.ok(trimSummary("A. ".repeat(500)).length <= 701);
});

test("wikipedia: tries the full name, then without the legal suffix", async () => {
  const asked: string[] = [];
  const fetcher = (async (url: string) => {
    asked.push(decodeURIComponent(url.split("/summary/")[1].split("?")[0]));
    return asked.length === 1 ? new Response("", { status: 404 }) : new Response(JSON.stringify(page()), { status: 200 });
  }) as unknown as typeof fetch;
  const found = await getCompanySummary("Reliance Industries Limited", fetcher, 1);
  assert.deepEqual(asked, ["Reliance_Industries_Limited", "Reliance_Industries"]);
  assert.match(found!.text, /conglomerate/);
});
