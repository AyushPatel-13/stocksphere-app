import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createInstrumentSearch,
  indianStockHref,
  normaliseQuery,
  type SearchDeps,
} from "../instruments";
import { matchTier } from "../rank";
import { GET } from "@/app/api/search/route";

function deps(overrides: Partial<SearchDeps> = {}): SearchDeps {
  return {
    searchIndian: async () => [
      { trading_symbol: "RELIANCE", instrument_key: "k1", segment: "NSE_EQ", instrument_type: "EQ", name: "RELIANCE INDUSTRIES LTD" },
      { trading_symbol: "RPOWER", instrument_key: "k2", segment: "NSE_EQ", instrument_type: "EQ", name: "RELIANCE POWER LTD." },
      { trading_symbol: "NIFTYBEES", instrument_key: "k3", segment: "NSE_EQ", instrument_type: "EQ", name: "NIP IND ETF NIFTY BEES" },
    ],
    searchUs: async () => [
      { symbol: "AAPL", description: "Apple Inc", type: "Common Stock" },
      { symbol: "QQQ", description: "Invesco QQQ Trust", type: "ETP" },
    ],
    now: () => 0,
    ...overrides,
  };
}

test("queries are trimmed and validated", () => {
  assert.equal(normaliseQuery("  tata   motors "), "tata motors");
  assert.equal(normaliseQuery("M&M"), "M&M");
  assert.equal(normaliseQuery(""), null);
  assert.equal(normaliseQuery("<script>"), null);
  assert.equal(normaliseQuery("x".repeat(41)), null);
});

test("ranking: exact ticker, ticker prefix, exact name, name prefix, then contains", () => {
  assert.equal(matchTier("TCS", "Tata Consultancy Services", "tcs"), 0);
  assert.equal(matchTier("RELIANCE", "Reliance Industries Ltd", "reli"), 1);
  assert.equal(matchTier("INFY", "Infosys Ltd", "infosys"), 2);
  assert.equal(matchTier("HDFCBANK", "HDFC Bank Ltd", "hdfc bank"), 2); // exact name
  assert.equal(matchTier("X", "HDFC Bank Securities Ltd", "hdfc bank"), 3); // name prefix
  assert.equal(matchTier("HCL-INSYS", "HCL Infosystems", "infosys"), 4);
});

test("Indian stocks outside the known universe link with .NS; known ones stay bare", () => {
  assert.equal(indianStockHref("TCS"), "/stock/TCS");
  assert.equal(indianStockHref("RPOWER"), "/stock/RPOWER.NS");
});

test("results merge every source, rank the exact ticker first, and link to the right page", async () => {
  const search = createInstrumentSearch(deps());
  const { results, partial } = await search("reliance");

  assert.equal(partial, false);
  assert.equal(results[0].symbol, "RELIANCE");
  assert.equal(results[0].href, "/stock/RELIANCE");
  assert.equal(results[0].market, "India");

  const rpower = results.find((r) => r.symbol === "RPOWER");
  assert.equal(rpower?.href, "/stock/RPOWER.NS");
});

test("local catalogs answer instantly: indices, ETFs, crypto and bonds with their own pages", async () => {
  const search = createInstrumentSearch(deps({ searchIndian: async () => [], searchUs: async () => [] }));

  const nifty = (await search("nifty")).results;
  assert.equal(nifty[0].href, "/asset/index/NIFTY");
  assert.equal(nifty[0].type, "index");

  assert.equal((await search("bank nifty")).results[0].symbol, "BANKNIFTY");
  assert.equal((await search("btc")).results[0].href, "/asset/crypto/BTC");
  assert.equal((await search("US10Y")).results[0].href, "/asset/bond/US10Y");

  // One character: local only, no provider calls.
  let called = false;
  const quiet = createInstrumentSearch(deps({ searchIndian: async () => { called = true; return []; } }));
  await quiet("t");
  assert.equal(called, false);
});

test("a catalog ETF found by a provider links to its ETF page, and is not listed twice", async () => {
  const { results } = await createInstrumentSearch(deps())("niftybees");
  const matches = results.filter((r) => r.symbol === "NIFTYBEES");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].href, "/asset/etf/NIFTYBEES");
  assert.equal(matches[0].type, "etf");
});

test("US listings: stocks link to the stock page, ETPs are ETFs", async () => {
  const { results } = await createInstrumentSearch(deps())("apple");
  const aapl = results.find((r) => r.symbol === "AAPL");
  assert.equal(aapl?.href, "/stock/AAPL");
  assert.equal(aapl?.exchange, "US");
});

test("provider results that don't contain the query are dropped", async () => {
  const search = createInstrumentSearch(
    deps({
      searchIndian: async () => [],
      searchUs: async () => [
        { symbol: "SPY", description: "SPDR S&P 500 ETF", type: "ETP" },
        { symbol: "DNUT", description: "Krispy Kreme Inc", type: "Common Stock" },
      ],
    })
  );
  const symbols = (await search("spy")).results.map((r) => r.symbol);
  assert.ok(symbols.includes("SPY"));
  assert.ok(!symbols.includes("DNUT"));
});

test("a failing provider makes the answer partial, keeps other results, and isn't cached", async () => {
  let calls = 0;
  const search = createInstrumentSearch(
    deps({
      searchIndian: async () => {
        calls++;
        throw new Error("UPSTOX_ACCESS_TOKEN is missing");
      },
    })
  );

  const first = await search("apple");
  assert.equal(first.partial, true);
  assert.ok(first.results.some((r) => r.symbol === "AAPL"));

  await search("apple");
  assert.equal(calls, 2);
});

test("full answers are cached; results are capped", async () => {
  let calls = 0;
  const search = createInstrumentSearch(deps({ searchUs: async () => { calls++; return []; } }));
  await search("tata");
  await search("tata");
  assert.equal(calls, 1);

  assert.ok((await search("nifty", 3)).results.length <= 3);
});

test("/api/search validates input and passes the query through", async () => {
  assert.equal((await GET(new Request("http://x/api/search?q=%3Cscript%3E"))).status, 400);
  assert.equal((await GET(new Request("http://x/api/search"))).status, 400);

  const response = await GET(
    new Request("http://x/api/search?q=tcs", { headers: { "x-forwarded-for": "10.0.0.1" } }),
    undefined,
    async (query) => ({ query, results: [], partial: false })
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.query, "tcs");
});

test("/api/search rate-limits a single client", async () => {
  const stub = async (query: string) => ({ query, results: [], partial: false });
  let status = 200;
  for (let i = 0; i < 61 && status === 200; i++) {
    status = (await GET(new Request("http://x/api/search?q=abc", { headers: { "x-forwarded-for": "10.9.9.9" } }), undefined, stub)).status;
  }
  assert.equal(status, 429);
});

test("queries with regex characters match literally", async () => {
  const search = createInstrumentSearch(deps({ searchIndian: async () => [], searchUs: async () => [] }));
  assert.equal((await search("s&p")).results[0].symbol, "SPX");
  // "." must not act as a wildcard: "t.s" is not "tcs".
  assert.ok(!(await search("t.s")).results.some((r) => r.symbol === "TCS"));
});

test("Indian ETFs are recognised from fund-house naming", async () => {
  const search = createInstrumentSearch(
    deps({
      searchIndian: async () => [
        { trading_symbol: "TATAGOLD", instrument_key: "k", segment: "NSE_EQ", instrument_type: "EQ", name: "TATAAML-TATAGOLD" },
        { trading_symbol: "TATASTEEL", instrument_key: "k2", segment: "NSE_EQ", instrument_type: "EQ", name: "TATA STEEL LIMITED" },
      ],
      searchUs: async () => [],
    })
  );
  const results = (await search("tata")).results;
  assert.equal(results.find((r) => r.symbol === "TATAGOLD")?.type, "etf");
  assert.equal(results.find((r) => r.symbol === "TATASTEEL")?.type, "stock");
});
