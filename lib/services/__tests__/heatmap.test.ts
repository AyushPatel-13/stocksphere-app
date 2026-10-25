import { test } from "node:test";
import assert from "node:assert/strict";

import { clearConstituentCache, getNseConstituents, parseConstituentCsv } from "../../apis/niftyIndices";
import { parseSpark, type SparkSeries } from "../../apis/yahooSpark";
import { US_LARGE_CAPS } from "../../analytics/screener";
import type { YahooFundamentals } from "../../apis/yahooFundamentals";
import type { AssetQuote } from "../../types/quote";
import type { History } from "../history";
import { buildHeatmap, clearHeatmapCache, getHeatmap, isHeatmapUniverse, marketCapOf, type HeatmapDeps } from "../heatmap";
import { buildMetrics, clearMetricsCache, type MetricsDeps } from "../heatmapMetrics";
import { GET } from "@/app/api/market/heatmap/route";
import { GET as metricsRoute } from "@/app/api/market/heatmap/metrics/route";

/* ------------------------------------------------------------ NSE lists */

const CSV = `Company Name,Industry,Symbol,Series,ISIN Code
Tata Consultancy Services Ltd.,Information Technology,TCS,EQ,INE467B01029
"Mahindra & Mahindra, Ltd.",Automobile and Auto Components,M&M,EQ,INE101A01026
Infosys Ltd.,,INFY,EQ,INE009A01021
Bad Row,IT,bad symbol!,EQ,INE000000000
Embassy Office Parks REIT,Realty,EMBASSY,RR,INE041025011
Dummy HEG Ltd.,Capital Goods,DUMMYHEG,EQ,DUM545A01024
Tata Consultancy Services Ltd.,Information Technology,TCS,EQ,INE467B01029
`;

test("parseConstituentCsv: real columns, quoted names, no sector → null, REITs kept, junk and dummy rows dropped", () => {
  const rows = parseConstituentCsv(CSV)!;
  assert.deepEqual(rows.map((r) => r.symbol), ["TCS", "M&M", "INFY", "EMBASSY"]);
  assert.equal(rows[1].name, "Mahindra & Mahindra, Ltd.");
  assert.equal(rows[0].sector, "Information Technology");
  assert.equal(rows[2].sector, null);
  assert.equal(rows[0].isin, "INE467B01029");
  assert.equal(parseConstituentCsv("<html>blocked</html>"), null);
  assert.equal(parseConstituentCsv("Company Name,Industry,Symbol,Series,ISIN Code\n"), null);
});

test("getNseConstituents: caches a day, keeps the last good list on failure, null if never loaded", async () => {
  clearConstituentCache();
  const ok = (async () => new Response(CSV, { status: 200 })) as unknown as typeof fetch;
  const fail = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  assert.equal(await getNseConstituents("niftyit", fail, 0), null, "never loaded → null, not a made-up list");
  const first = await getNseConstituents("niftyit", ok, 0);
  assert.equal(first?.constituents.length, 4);
  const stale = await getNseConstituents("niftyit", fail, 25 * 60 * 60_000);
  assert.equal(stale?.constituents.length, 4);
  clearConstituentCache();
});

test("getNseConstituents: falls back to NSE's archive copy when niftyindices.com answers with a status page", async () => {
  clearConstituentCache();
  const hosts: string[] = [];
  const fetcher = (async (url: string) => {
    const host = new URL(url).host;
    hosts.push(host);
    return host === "www.niftyindices.com"
      ? new Response("<html>Sitefinity status</html>", { status: 200 })
      : new Response(CSV, { status: 200 });
  }) as unknown as typeof fetch;
  const list = await getNseConstituents("niftyit", fetcher, 0);
  assert.deepEqual(hosts, ["www.niftyindices.com", "nsearchives.nseindia.com"]);
  assert.equal(list?.constituents.length, 4);
  assert.equal(list?.source, "NSE Indices constituent list (NSE archive copy)");
  clearConstituentCache();
});

/* ------------------------------------------------------------ spark */

test("parseSpark: closes aligned with times, null closes skipped, periods in ms", () => {
  const body = {
    spark: {
      result: [
        {
          symbol: "TCS.NS",
          response: [
            {
              meta: {
                exchangeTimezoneName: "Asia/Kolkata",
                chartPreviousClose: 100,
                regularMarketPrice: 101,
                regularMarketTime: 1_700_000_000,
                currentTradingPeriod: { regular: { start: 1_699_990_000, end: 1_700_012_500 } },
              },
              timestamp: [1, 2, 3],
              indicators: { quote: [{ close: [100, null, 102] }] },
            },
          ],
        },
        { symbol: "BROKEN", response: [] },
      ],
    },
  };
  const out = parseSpark(body);
  const s = out.get("TCS.NS")!;
  assert.deepEqual(s.times, [1000, 3000]);
  assert.deepEqual(s.closes, [100, 102]);
  assert.equal(s.timeZone, "Asia/Kolkata");
  assert.deepEqual(s.periods.regular, { start: 1_699_990_000_000, end: 1_700_012_500_000 });
  assert.equal(s.periods.pre, null);
  assert.equal(out.has("BROKEN"), false);
  assert.equal(parseSpark({ garbage: true }).size, 0);
});

/* ------------------------------------------------------------ base heatmap */

const shares = (value: number): YahooFundamentals => ({ epsTtm: null, sharesOutstanding: { value, asOf: "2026-06-30" }, currency: null });

const history = (closes: number[], previousClose: number | null, open = closes[0]): History => ({
  type: "stock",
  symbol: "X",
  name: "Apple Inc.",
  unit: "currency",
  currency: "USD",
  range: "1d",
  interval: "1m",
  candles: closes.map((c, i) => ({ t: 1_000 + i * 60_000, o: i === 0 ? open : c, h: c, l: c, c, v: 10 })),
  previousClose,
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  marketTime: "2026-10-19T20:00:00.000Z",
  sessionStart: null,
  sessionEnd: null,
  source: "Yahoo",
});

function deps(overrides: Partial<HeatmapDeps> = {}): HeatmapDeps {
  return {
    constituents: async () => ({
      constituents: [
        { symbol: "TCS", name: "Tata Consultancy Services Ltd.", sector: "Information Technology", isin: "INE467B01029" },
        { symbol: "INFY", name: "Infosys Ltd.", sector: null, isin: "INE009A01021" },
        { symbol: "M&M", name: "Mahindra & Mahindra Ltd.", sector: "Automobile and Auto Components", isin: "INE101A01026" },
      ],
      fetchedAt: "2026-10-20T00:00:00.000Z",
      source: "NSE Indices constituent list",
    }),
    upstoxQuotes: async (keys) =>
      new Map<string, AssetQuote>(
        [
          [keys[0], { symbol: "TCS", price: 4040, change: 40, changePercent: 1, previousClose: 4000, open: 4010, volume: 1_000 }],
          [keys[1], { symbol: "INFY", price: 1500, previousClose: 0, open: 0, volume: 0 }],
        ] as [string, AssetQuote][]
      ),
    usHistory: async (s) => (s === "AAPL" ? history([200, 202], 198, 199) : null),
    usIndustry: async (s) => (s === "AAPL" ? "Technology" : null),
    fundamentals: async (symbol) => (symbol === "TCS.NS" ? shares(3.6e9) : symbol === "AAPL" ? shares(15e9) : null),
    now: () => Date.parse("2026-10-20T04:00:00Z"),
    capBudgetMs: 1_000,
    ...overrides,
  };
}

test("marketCapOf: price × shares, null without either", () => {
  assert.deepEqual(marketCapOf(10, shares(5)), { marketCap: 50, sharesAsOf: "2026-06-30" });
  assert.deepEqual(marketCapOf(null, shares(5)), { marketCap: null, sharesAsOf: null });
  assert.deepEqual(marketCapOf(10, null), { marketCap: null, sharesAsOf: null });
});

test("buildHeatmap NSE: ISIN instrument keys, NSE sector, real caps only, missing data stays null", async () => {
  clearHeatmapCache();
  let asked: string[] = [];
  const data = await buildHeatmap("nifty50", deps({ upstoxQuotes: async (keys) => ((asked = keys), deps().upstoxQuotes(keys)) }));
  assert.ok(data);
  assert.deepEqual(asked, ["NSE_EQ|INE467B01029", "NSE_EQ|INE009A01021", "NSE_EQ|INE101A01026"]);
  assert.equal(data.priceSource, "Upstox");
  assert.equal(data.sector.available, true);
  assert.equal(data.industry.available, false);
  const [tcs, infy, mm] = data.tiles;
  assert.equal(tcs.href, "TCS.NS");
  assert.equal(tcs.marketCap, 4040 * 3.6e9);
  assert.equal(tcs.changePercent, 1);
  assert.ok(Math.abs(tcs.gap! - 0.25) < 1e-9);
  assert.equal(tcs.sector, "Information Technology");
  assert.equal(infy.price, 1500);
  assert.equal(infy.changePercent, null, "no previous close → no change, not 0%");
  assert.equal(infy.gap, null);
  assert.equal(infy.marketCap, null);
  assert.equal(infy.sector, null);
  assert.equal(mm.price, null);
  assert.equal(data.capsPending, 0);
  clearHeatmapCache();
});

test("buildHeatmap: unavailable when constituents or every quote is missing", async () => {
  clearHeatmapCache();
  assert.equal(await buildHeatmap("nifty500", deps({ constituents: async () => null })), null);
  assert.equal(await buildHeatmap("nifty50", deps({ upstoxQuotes: async () => new Map() })), null);
  assert.equal(await buildHeatmap("us", deps({ usHistory: async () => null })), null);
});

test("buildHeatmap us: Yahoo history, Finnhub industry, open-based gap", async () => {
  clearHeatmapCache();
  const data = await buildHeatmap("us", deps());
  assert.ok(data);
  assert.equal(data.tiles.length, US_LARGE_CAPS.length);
  const aapl = data.tiles.find((t) => t.symbol === "AAPL")!;
  assert.equal(aapl.price, 202);
  assert.equal(aapl.industry, "Technology");
  assert.equal(aapl.marketCap, 202 * 15e9);
  assert.ok(Math.abs(aapl.gap! - ((199 - 198) / 198) * 100) < 1e-9);
  assert.equal(aapl.volume, 20);
  assert.equal(data.sector.available, false);
  assert.equal(data.industry.available, true);
  clearHeatmapCache();
});

test("market caps: a slow lookup is reported pending, finishes in the background, and isn't cached until settled", async () => {
  clearHeatmapCache();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const d = deps({ capBudgetMs: 5, fundamentals: async (s) => (await gate, s === "TCS.NS" ? shares(1e9) : null) });
  const first = await getHeatmap("nifty50", d);
  assert.equal(first?.capsPending, 2, "TCS and INFY are priced; M&M has no quote so needs no cap");
  assert.equal(first?.tiles[0].marketCap, null);
  release();
  await new Promise((r) => setTimeout(r, 10));
  const second = await getHeatmap("nifty50", d);
  assert.equal(second?.capsPending, 0);
  assert.equal(second?.tiles[0].marketCap, 4040 * 1e9);
  clearHeatmapCache();
});

test("route: 400 for an unknown universe, 503 when unavailable, 200 with data, 500 on a throw", async () => {
  assert.equal(isHeatmapUniverse("nifty500"), true);
  assert.equal(isHeatmapUniverse("sensex"), false);
  const bad = await GET(new Request("http://x/api/market/heatmap?universe=sensex"));
  assert.equal(bad.status, 400);
  const down = await GET(new Request("http://x/api/market/heatmap?universe=nifty500"), undefined, async () => null);
  assert.equal(down.status, 503);
  assert.deepEqual(Object.keys(await down.json()).sort(), ["error", "success"]);
  clearHeatmapCache();
  const ok = await GET(new Request("http://x/api/market/heatmap"), undefined, (u) => buildHeatmap(u, deps()));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).universe, "nifty50");
  const thrown = await GET(new Request("http://x/api/market/heatmap?universe=us"), undefined, async () => {
    throw new Error("boom");
  });
  assert.equal(thrown.status, 500);
});

/* ------------------------------------------------------------ metric sets */

const DAY = 86_400_000;
/** Daily bars at 09:15 IST (03:45 UTC) on consecutive weekdays ending 2026-10-19. */
function dailySeries(closes: number[]): SparkSeries {
  const times: number[] = [];
  let d = Date.UTC(2026, 9, 19, 3, 45);
  for (let i = 0; i < closes.length; i++) {
    times.unshift(d);
    do d -= DAY;
    while ([0, 6].includes(new Date(d).getUTCDay()));
  }
  return { symbol: "TCS.NS", timeZone: "Asia/Kolkata", times, closes, previousClose: null, regularMarketPrice: null, regularMarketTime: null, periods: { pre: null, regular: null, post: null } };
}

function metricsDeps(overrides: Partial<MetricsDeps> = {}): MetricsDeps {
  return {
    symbols: async (u) => (u === "nifty500" ? Array.from({ length: 500 }, (_, i) => `S${i}`) : ["TCS", "INFY"]),
    spark: async (symbols, params) => new Map(params.interval === "1d" ? [["TCS.NS", dailySeries(Array.from({ length: 300 }, (_, i) => 100 + i))]] : []),
    dailyHistory: async () => null,
    now: () => Date.parse("2026-10-20T12:00:00Z"),
    ...overrides,
  };
}

test("buildMetrics daily: performance windows per stock, a stock with no series gets nulls", async () => {
  const r = await buildMetrics("nifty50", "daily", metricsDeps());
  assert.ok(!("error" in r));
  const tcs = r.values.TCS;
  assert.equal(tcs.perf1w?.from, "2026-10-12 close");
  assert.equal(tcs.perf1w?.to, "2026-10-19 close");
  assert.ok(Math.abs(tcs.perf1w!.value - ((399 - 394) / 394) * 100) < 1e-9);
  assert.ok(tcs.volatility && tcs.volatility.value > 0);
  assert.equal(r.values.INFY.perf1w, null);
  assert.equal(r.values.INFY.volatility, null);
});

test("buildMetrics: relative volume refused for big universes; unavailable sources are errors, not zeros", async () => {
  const big = await buildMetrics("nifty500", "volume", metricsDeps());
  assert.ok("error" in big && big.status === 400);
  const none = await buildMetrics("nifty50", "volume", metricsDeps());
  assert.ok("error" in none && none.status === 503);
  const noSpark = await buildMetrics("nifty50", "intraday", metricsDeps({ spark: async () => new Map() }));
  assert.ok("error" in noSpark && noSpark.status === 503);
  const noList = await buildMetrics("nifty200", "daily", metricsDeps({ symbols: async () => null }));
  assert.ok("error" in noList && noList.status === 503);
});

test("buildMetrics volume: ratio of the latest bar to the 20 before it", async () => {
  const candles = Array.from({ length: 25 }, (_, i) => ({ t: i * DAY, o: 1, h: 1, l: 1, c: 1, v: i === 24 ? 300 : 100 }));
  const r = await buildMetrics("nifty50", "volume", metricsDeps({ dailyHistory: async (s) => (s === "TCS.NS" ? { ...history([1], 1), candles } : null) }));
  assert.ok(!("error" in r));
  assert.equal(r.values.TCS.relvol?.value, 3);
  assert.equal(r.values.INFY.relvol, null);
});

test("metrics route: validates universe and set, maps errors to status codes", async () => {
  clearMetricsCache();
  assert.equal((await metricsRoute(new Request("http://x/m?universe=nifty50&set=weekly"))).status, 400);
  assert.equal((await metricsRoute(new Request("http://x/m?universe=nope&set=daily"))).status, 400);
  const err = await metricsRoute(new Request("http://x/m?universe=nifty500&set=volume"), undefined, async () => ({ error: "too big", status: 400 }));
  assert.equal(err.status, 400);
  const ok = await metricsRoute(new Request("http://x/m?universe=nifty50&set=daily"), undefined, (u, s) => buildMetrics(u, s, metricsDeps()));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).set, "daily");
});
