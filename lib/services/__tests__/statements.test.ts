import { test } from "node:test";
import assert from "node:assert/strict";

import { GET } from "@/app/api/financials/route";
import {
  formatPerShare,
  formatStatementMoney,
  getYahooStatements,
  growth,
  netMargin,
  parseStatements,
  periodLabel,
} from "@/lib/apis/yahooStatements";

/** Financial statements: reported figures only, in the reported currency, with gaps left as gaps. */

const point = (asOfDate: string, raw: number, currencyCode = "INR") => ({ asOfDate, currencyCode, periodType: "12M", reportedValue: { raw, fmt: String(raw) } });
const series = (type: string, points: unknown[]) => ({ meta: { symbol: ["RELIANCE.NS"], type: [type] }, timestamp: [], [type]: points });

// RELIANCE.NS as Yahoo's fundamentals-timeseries answered on 14 Nov 2026 (a subset of its series).
const RELIANCE = {
  timeseries: {
    result: [
      series("annualTotalRevenue", [point("2023-03-31", 8.78e12), point("2024-03-31", 9.01e12), point("2025-03-31", 9.65e12), point("2026-03-31", 10.57e12)]),
      series("annualNetIncome", [point("2023-03-31", 667.02e9), point("2024-03-31", 696.21e9), point("2025-03-31", 696.48e9), point("2026-03-31", 807.75e9)]),
      series("annualDilutedEPS", [point("2025-03-31", 51.47), point("2026-03-31", 59.69)]),
      series("annualTotalAssets", [point("2026-03-31", 21.78e12)]),
      series("annualFreeCashFlow", [point("2023-03-31", -259.56e9), point("2026-03-31", 691.97e9)]),
      series("annualCapitalExpenditure", [point("2026-03-31", -1.23e12)]),
      // A series Yahoo lists but has no figures for, and malformed points.
      { meta: { type: ["annualGrossProfit"] }, timestamp: [] },
      series("quarterlyTotalRevenue", [point("2026-06-30", 3.09e12), point("2026-09-30", 3.31e12), null, { asOfDate: "soon", reportedValue: { raw: 1 } }, { asOfDate: "2026-12-31", reportedValue: {} }]),
      series("quarterlyNetIncome", [point("2026-09-30", 255.48e9)]),
    ],
    error: null,
  },
};

test("statements carry the reported figures by period, oldest first, with gaps left as null", () => {
  const parsed = parseStatements(RELIANCE);
  assert.ok(parsed);
  assert.equal(parsed.currency, "INR");
  assert.deepEqual(parsed.annual.map((p) => p.asOf), ["2023-03-31", "2024-03-31", "2025-03-31", "2026-03-31"]);
  const latest = parsed.annual[3].values;
  assert.deepEqual(
    [latest.revenue, latest.netIncome, latest.eps, latest.totalAssets, latest.freeCashFlow, latest.capex],
    [10.57e12, 807.75e9, 59.69, 21.78e12, 691.97e9, -1.23e12]
  );
  // Not reported for that year: null, not zero and not the next year's figure.
  assert.equal(parsed.annual[0].values.eps, null);
  assert.equal(parsed.annual[0].values.totalAssets, null);
  assert.equal(parsed.annual[0].values.grossProfit, null);
  // Malformed quarterly points are dropped, so there are two quarters, not five.
  assert.deepEqual(parsed.quarterly.map((p) => p.asOf), ["2026-06-30", "2026-09-30"]);
  assert.equal(parsed.quarterly[0].values.netIncome, null);

  // Only the last four years and five quarters are kept.
  const many = { timeseries: { result: [series("annualTotalRevenue", [2019, 2020, 2021, 2022, 2023, 2024].map((y) => point(`${y}-03-31`, y)))] } };
  assert.deepEqual(parseStatements(many)?.annual.map((p) => p.asOf.slice(0, 4)), ["2021", "2022", "2023", "2024"]);
});

test("an answer with no figures is no statements at all, and mixed currencies name none", () => {
  for (const empty of [null, {}, { timeseries: {} }, { timeseries: { result: [] } }, { timeseries: { result: [{ meta: { type: ["annualTotalRevenue"] } }] } }]) {
    assert.equal(parseStatements(empty), null);
  }
  const mixed = { timeseries: { result: [series("annualTotalRevenue", [point("2026-03-31", 5, "INR")]), series("annualNetIncome", [point("2026-03-31", 1, "USD")])] } };
  assert.equal(parseStatements(mixed)?.currency, null);
});

test("amounts are written the way each market writes them, and never rounded into a different number", () => {
  assert.equal(formatStatementMoney(10.57e12, "INR"), "₹10.57 L Cr");
  assert.equal(formatStatementMoney(807.75e9, "INR"), "₹80,775 Cr");
  assert.equal(formatStatementMoney(-259.56e9, "INR"), "−₹25,956 Cr");
  assert.equal(formatStatementMoney(52.5e7, "INR"), "₹52.5 Cr");
  assert.equal(formatStatementMoney(478.83e9, "USD"), "$478.83B");
  assert.equal(formatStatementMoney(1.2e12, "USD"), "$1.20T");
  assert.equal(formatStatementMoney(-9.04e9, "USD"), "−$9.04B");
  assert.equal(formatStatementMoney(3.5e9, "EUR"), "3.50B EUR");
  assert.equal(formatStatementMoney(0, "USD"), "$0.00M");
  assert.equal(formatStatementMoney(null, "INR"), "—");
  assert.equal(formatPerShare(59.69, "INR"), "₹59.69");
  assert.equal(formatPerShare(-1.5, "USD"), "−$1.50");
  assert.equal(formatPerShare(null, "USD"), "—");
  assert.equal(periodLabel("2026-03-31", "annual"), "FY Mar 2026");
  assert.equal(periodLabel("2026-09-30", "quarterly"), "Sep 2026");
});

test("growth and net margin are calculated only from two reported figures", () => {
  const parsed = parseStatements(RELIANCE)!;
  assert.equal(netMargin(parsed.annual[3])?.toFixed(2), "7.64"); // 807.75 / 10,570
  assert.equal(netMargin(parsed.quarterly[0]), null); // no net income reported for that quarter
  assert.equal(growth(10.57e12, 9.65e12)?.toFixed(2), "9.53");
  for (const [current, previous] of [[100, null], [null, 100], [100, 0], [100, -50], [-10, 100]] as const) assert.equal(growth(current, previous), null);
});

test("statements are cached for six hours; a failure is retried, not remembered", async () => {
  let calls = 0;
  let body: unknown = RELIANCE;
  const fetcher = (async () => {
    calls++;
    return body === null ? new Response("nope", { status: 500 }) : new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;

  body = null;
  assert.equal(await getYahooStatements("CACHETEST.NS", fetcher, 0), null);
  body = RELIANCE;
  assert.equal((await getYahooStatements("CACHETEST.NS", fetcher, 1))?.annual.length, 4);
  await getYahooStatements("CACHETEST.NS", fetcher, 5 * 3_600_000);
  assert.equal(calls, 2);
  await getYahooStatements("CACHETEST.NS", fetcher, 7 * 3_600_000);
  assert.equal(calls, 3);
});

test("the route: a real symbol's statements, 400 for nonsense, 404 when there are none", async () => {
  const asked: string[] = [];
  const load = async (yahoo: string) => {
    asked.push(yahoo);
    return yahoo === "RELIANCE.NS" ? parseStatements(RELIANCE) : null;
  };
  const ok = await GET(new Request("http://x/api/financials?symbol=reliance"), undefined, load);
  const json = await ok.json();
  assert.deepEqual([ok.status, json.symbol, json.currency, json.source, json.annual.length], [200, "RELIANCE", "INR", "Yahoo Finance", 4]);
  assert.equal((await GET(new Request("http://x/api/financials?symbol=NIFTYBEES"), undefined, load)).status, 404);
  assert.equal((await GET(new Request("http://x/api/financials"), undefined, load)).status, 400);
  assert.equal((await GET(new Request("http://x/api/financials?symbol=%3Cscript%3E"), undefined, load)).status, 400);
  assert.equal((await GET(new Request("http://x/api/financials?symbol=AAPL"), undefined, async () => Promise.reject(new Error("down")))).status, 404);
  assert.deepEqual(asked, ["RELIANCE.NS", "NIFTYBEES.NS"]);
});
