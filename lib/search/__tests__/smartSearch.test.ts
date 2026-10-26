import { test } from "node:test";
import assert from "node:assert/strict";

import { GET } from "@/app/api/search/route";
import { createInstrumentSearch, nameInitials, type SearchDeps } from "../instruments";
import { HOLDING_TYPES, holdingInstrumentError, storedSymbolFor } from "../pick";
import {
  MAX_LIMIT,
  assetLabel,
  filterKeyOf,
  filtersFromKey,
  matchesFilters,
  nextActiveIndex,
  parseFilters,
  parseQuery,
  searchUrl,
  type SearchResult,
} from "../types";

/*
 * Provider fixtures. The Upstox rows are the trading symbols and names Upstox's
 * NSE instrument search returned for "SBI", "state bank" and "Gold" through
 * this app's /api/search on 2026-10-25; the US rows are what Finnhub returned
 * for "state bank" the same day. Nothing here is invented: these are the real
 * listings the engine is expected to rank.
 */
const UPSTOX_ROWS = [
  { trading_symbol: "SBILIFE", name: "SBI LIFE INSURANCE CO LTD" },
  { trading_symbol: "SBICARD", name: "SBI CARDS & PAY SER LTD" },
  { trading_symbol: "SBIFUNDS", name: "SBI FUNDS MANAGEMENT LTD" },
  { trading_symbol: "SBISILVER", name: "SBIAMC - SBISILVER" },
  { trading_symbol: "SBILIQETF", name: "SBIAMC - SBILIQETF" },
  { trading_symbol: "SBIN", name: "STATE BANK OF INDIA" },
  { trading_symbol: "GOLDIETF", name: "ICICI PRUDENTIAL GOLD ETF" },
  { trading_symbol: "GOLDBEES", name: "Nippon India Gold BeES" },
  { trading_symbol: "GOLDIAM", name: "GOLDIAM INTERNATIONAL LTD" },
  { trading_symbol: "RELIANCE", name: "RELIANCE INDUSTRIES LTD" },
  { trading_symbol: "HDFCBANK", name: "HDFC BANK LTD" },
  { trading_symbol: "TATASTEEL", name: "TATA STEEL LIMITED" },
  { trading_symbol: "TATAPOWER", name: "TATA POWER CO LTD" },
  { trading_symbol: "HINDUNILVR", name: "HINDUSTAN UNILEVER LTD." },
].map((row, i) => ({ ...row, instrument_key: `NSE_EQ|k${i}`, segment: "NSE_EQ", instrument_type: "EQ" }));

const US_ROWS = [
  { symbol: "AAPL", description: "Apple Inc", type: "Common Stock" },
  { symbol: "GOLD", description: "GOLD.COM INC", type: "Common Stock" },
  { symbol: "DSBX", description: "Dogwood State Bank", type: "Common Stock" },
  { symbol: "SSBI", description: "Summit State Bank", type: "Common Stock" },
];

/** Providers that return every fixture row, as a loose provider search does; the engine must filter. */
function deps(overrides: Partial<SearchDeps> = {}): SearchDeps {
  return {
    searchIndian: async () => UPSTOX_ROWS,
    searchUs: async () => US_ROWS,
    now: () => 0,
    ...overrides,
  };
}

const symbolsOf = (results: SearchResult[]) => results.map((r) => r.symbol);

/* ------------------------------------------------------------ SBI */

test("SBI: State Bank of India first, then SBI Life, SBI Cards and SBI Funds, each once", async () => {
  const { results, partial } = await createInstrumentSearch(deps())("SBI", 10);
  const symbols = symbolsOf(results);

  assert.equal(partial, false);
  assert.equal(symbols[0], "SBIN");
  for (const symbol of ["SBILIFE", "SBICARD", "SBIFUNDS"]) assert.ok(symbols.includes(symbol), symbol);
  assert.equal(new Set(results.map((r) => r.id)).size, results.length, "no duplicates");
  // Only genuine matches: nothing whose ticker or name doesn't start with SBI.
  assert.ok(!symbols.includes("RELIANCE") && !symbols.includes("GOLDIAM"));

  const sbin = results[0];
  assert.deepEqual(
    { name: sbin.name, exchange: sbin.exchange, type: sbin.type, market: sbin.market, currency: sbin.currency, href: sbin.href },
    { name: "State Bank of India", exchange: "NSE", type: "stock", market: "India", currency: "INR", href: "/stock/SBIN" }
  );
  // Outside the known universe, an NSE listing links by its .NS id.
  assert.equal(results.find((r) => r.symbol === "SBICARD")?.href, "/stock/SBICARD.NS");
});

test("two characters already search the providers: SB lists the SBI companies, stocks-only for a Stock field", async () => {
  let asked = 0;
  const search = createInstrumentSearch(
    deps({
      searchIndian: async () => {
        asked++;
        return UPSTOX_ROWS;
      },
    })
  );
  const symbols = symbolsOf((await search("SB", 10, { types: ["stock"] })).results);
  assert.equal(asked, 1);
  for (const symbol of ["SBIN", "SBILIFE", "SBICARD", "SBIFUNDS"]) assert.ok(symbols.includes(symbol), symbol);
  assert.ok(!symbols.includes("SBISILVER"), "an ETF isn't offered to a Stock field");
  // DSBX matches on its ticker containing SB, but ranks below every ticker starting with SB.
  assert.ok(symbols.indexOf("DSBX") === -1 || symbols.indexOf("DSBX") > symbols.indexOf("SBIFUNDS"));
});

test("name, partial and case-insensitive matches: state bank, sbi life, sbin", async () => {
  const search = createInstrumentSearch(deps());

  const stateBank = symbolsOf((await search("state bank")).results);
  assert.equal(stateBank[0], "SBIN", "the Indian name match outranks US banks only containing it later");
  assert.ok(stateBank.includes("DSBX"), "genuine US matches are still listed");

  assert.equal((await search("sbi life")).results[0].symbol, "SBILIFE");
  assert.equal((await search("sbin")).results[0].symbol, "SBIN");
  assert.equal((await search("SBIN")).results[0].symbol, "SBIN");
});

test("the test queries rank the instrument people mean first", async () => {
  const search = createInstrumentSearch(deps());
  const first = async (query: string) => (await search(query)).results[0];

  assert.equal((await first("TCS")).symbol, "TCS");
  assert.equal((await first("RELIANCE")).symbol, "RELIANCE");
  assert.equal((await first("HDFCBANK")).symbol, "HDFCBANK");
  assert.equal((await first("AAPL")).symbol, "AAPL");
  assert.equal((await first("Apple")).symbol, "AAPL");
  assert.equal((await first("NIFTY")).href, "/asset/index/NIFTY");

  const tata = symbolsOf((await search("Tata", 10)).results);
  for (const symbol of ["TCS", "TATAMOTORS", "TATASTEEL", "TATAPOWER"]) assert.ok(tata.includes(symbol), symbol);
});

test("Gold finds the MCX future, gold ETFs and the US ticker GOLD as distinct instruments", async () => {
  const { results } = await createInstrumentSearch(deps())("Gold", 15);
  const commodity = results.find((r) => r.type === "commodity" && r.symbol === "GOLD");
  const usStock = results.find((r) => r.market === "US" && r.symbol === "GOLD");

  assert.equal(commodity?.href, "/commodities/GOLD");
  assert.equal(commodity?.exchange, "MCX");
  assert.equal(usStock?.href, "/stock/GOLD");
  assert.notEqual(commodity?.id, usStock?.id);
  assert.ok(results.some((r) => r.symbol === "GOLDBEES" && r.type === "etf"));
  // Exact tickers first.
  assert.deepEqual(symbolsOf(results.slice(0, 2)).sort(), ["GOLD", "GOLD"]);
});

/* ------------------------------------------------------------ initials */

test("initials come from real names, skip 'of', and need two words", () => {
  assert.deepEqual(nameInitials("State Bank of India"), ["sbi"]);
  assert.ok(nameInitials("HINDUSTAN UNILEVER LTD.").includes("hul"));
  assert.ok(nameInitials("Tata Consultancy Services").includes("tcs"));
  assert.deepEqual(nameInitials("Infosys"), []);
});

test("an initials query matches the provider's row; short abbreviations don't", async () => {
  const search = createInstrumentSearch(deps());
  assert.ok(symbolsOf((await search("hul")).results).includes("HINDUNILVR"));

  // Two letters are too ambiguous to be initials: "hu" mustn't pull in every
  // two-word name starting H… U…, only real ticker/name prefixes.
  const twoLetters = createInstrumentSearch(
    deps({
      searchIndian: async () => [{ trading_symbol: "XYZ", name: "HAPPY UNITS LTD", instrument_key: "k", segment: "NSE_EQ", instrument_type: "EQ" }],
      searchUs: async () => [],
    })
  );
  assert.ok(!symbolsOf((await twoLetters("hu")).results).includes("XYZ"));
});

/* ------------------------------------------------------------ query parsing */

test("queries tolerate case, spaces and punctuation, and read exchange prefixes and suffixes", () => {
  assert.deepEqual(parseQuery("  sbi,  "), { text: "sbi", filters: {} });
  assert.deepEqual(parseQuery("(TCS)"), { text: "TCS", filters: {} });
  assert.deepEqual(parseQuery("NSE:SBIN"), { text: "SBIN", filters: { exchange: "NSE" } });
  assert.deepEqual(parseQuery("nse : sbin"), { text: "sbin", filters: { exchange: "NSE" } });
  assert.deepEqual(parseQuery("SBIN.NS"), { text: "SBIN", filters: { exchange: "NSE" } });
  assert.deepEqual(parseQuery("RELIANCE.BO"), { text: "RELIANCE", filters: { exchange: "BSE" } });
  assert.deepEqual(parseQuery("NASDAQ:AAPL"), { text: "AAPL", filters: { market: "US" } });
  assert.deepEqual(parseQuery("M&M"), { text: "M&M", filters: {} });
  assert.deepEqual(parseQuery("state bank"), { text: "state bank", filters: {} }, "a plain word isn't an exchange");
  assert.equal(parseQuery("   "), null);
  assert.equal(parseQuery("!!!"), null);
  assert.equal(parseQuery("x".repeat(41)), null);
});

/* ------------------------------------------------------------ filters */

test("filters narrow results and skip providers that can't hold a match", async () => {
  let indianCalls = 0;
  let usCalls = 0;
  const search = createInstrumentSearch(
    deps({
      searchIndian: async () => {
        indianCalls++;
        return UPSTOX_ROWS;
      },
      searchUs: async () => {
        usCalls++;
        return US_ROWS;
      },
    })
  );

  const crypto = await search("bt", 8, { types: ["crypto"] });
  assert.ok(crypto.results.every((r) => r.type === "crypto"));
  assert.equal(indianCalls + usCalls, 0, "a crypto-only field asks neither stock provider");

  const us = await search("gold", 8, { market: "US" });
  assert.ok(us.results.every((r) => r.market === "US"));
  assert.equal(indianCalls, 0);

  const mcx = await search("gold", 8, { exchange: "MCX" });
  assert.ok(mcx.results.length > 0 && mcx.results.every((r) => r.exchange === "MCX"));

  const nse = await search("SBIN", 8, { exchange: "NSE" });
  assert.equal(nse.results[0].symbol, "SBIN");

  const holdings = await search("gold", 15, { types: HOLDING_TYPES });
  assert.ok(holdings.results.every((r) => r.type === "stock" || r.type === "etf"));
});

test("a BSE filter keeps the NSE listing of an Indian stock (BSE isn't searched separately)", () => {
  const sbin: SearchResult = { id: "India:SBIN", symbol: "SBIN", name: "State Bank of India", type: "stock", exchange: "NSE", market: "India", currency: "INR", href: "/stock/SBIN" };
  const nifty: SearchResult = { ...sbin, id: "index:NIFTY", symbol: "NIFTY", type: "index" };
  assert.equal(matchesFilters(sbin, { exchange: "BSE" }), true);
  assert.equal(matchesFilters(nifty, { exchange: "BSE" }), false);
  assert.equal(matchesFilters(sbin, { types: ["etf"] }), false);
  assert.equal(matchesFilters(sbin, { market: "US" }), false);
});

/* ------------------------------------------------------------ states */

test("no results, result limits and the empty query", async () => {
  const search = createInstrumentSearch(deps());
  assert.deepEqual((await search("zzqxv")).results, []);
  assert.ok((await search("s", 100)).results.length <= MAX_LIMIT);
  assert.ok((await search("sbi", 2)).results.length <= 2);
});

test("a provider that times out makes the answer partial without losing the others", async () => {
  const search = createInstrumentSearch(
    deps({
      searchIndian: () => new Promise(() => {}),
      timeoutMs: 20,
    })
  );
  const started = Date.now();
  const { results, partial } = await search("state bank");
  assert.equal(partial, true);
  assert.ok(Date.now() - started < 1_000);
  assert.ok(symbolsOf(results).includes("SBIN"), "the local catalogue still answers");
  assert.ok(symbolsOf(results).includes("DSBX"), "the US provider still answers");
});

test("a provider error makes the answer partial", async () => {
  const search = createInstrumentSearch(deps({ searchUs: async () => { throw new Error("rate limited"); } }));
  const { results, partial } = await search("sbi");
  assert.equal(partial, true);
  assert.equal(results[0].symbol, "SBIN");
});

/* ------------------------------------------------------------ API */

test("/api/search passes the query's exchange and the caller's filters, and refuses unknown filters", async () => {
  const seen: unknown[] = [];
  const stub = async (query: string, _limit?: number, filters?: unknown) => {
    seen.push({ query, filters });
    return { query, results: [], partial: false };
  };
  const call = (qs: string) => GET(new Request(`http://x/api/search?${qs}`, { headers: { "x-forwarded-for": "10.1.2.3" } }), undefined, stub);

  assert.equal((await call("q=NSE%3ASBIN")).status, 200);
  assert.deepEqual(seen.at(-1), { query: "SBIN", filters: { exchange: "NSE" } });

  assert.equal((await call("q=gold&types=commodity,etf&market=india")).status, 200);
  assert.deepEqual(seen.at(-1), { query: "gold", filters: { types: ["commodity", "etf"], market: "India" } });

  assert.equal((await call("q=sbi&types=option")).status, 400);
  assert.equal((await call("q=sbi&market=mars")).status, 400);
  assert.equal((await call("q=sbi&exchange=LSE")).status, 400);
  assert.equal((await call("q=%21%21")).status, 400);
});

test("parseFilters: URL filters override the ones the query named", () => {
  const params = new URLSearchParams({ exchange: "MCX" });
  assert.deepEqual(parseFilters(params, { exchange: "NSE" }), { exchange: "MCX" });
});

/* ------------------------------------------------------------ browser helpers */

test("keyboard: arrows wrap, Home/End jump, an empty list highlights nothing", () => {
  assert.equal(nextActiveIndex("ArrowDown", -1, 3), 0);
  assert.equal(nextActiveIndex("ArrowDown", 2, 3), 0);
  assert.equal(nextActiveIndex("ArrowUp", 0, 3), 2);
  assert.equal(nextActiveIndex("ArrowUp", -1, 3), 2);
  assert.equal(nextActiveIndex("Home", 2, 3), 0);
  assert.equal(nextActiveIndex("End", 0, 3), 2);
  assert.equal(nextActiveIndex("ArrowDown", -1, 0), -1);
  assert.equal(nextActiveIndex("Enter", 1, 3), undefined);
  assert.equal(nextActiveIndex("a", 1, 3), undefined);
});

test("the search URL carries a field's filters, and the filter key round-trips", () => {
  assert.equal(searchUrl("sbi", 8), "/api/search?q=sbi&limit=8");
  assert.equal(searchUrl("state bank", 8, { types: ["stock", "etf"], market: "India" }), "/api/search?q=state+bank&limit=8&types=stock%2Cetf&market=India");

  const key = filterKeyOf(["stock", "etf"], "India", "NSE");
  assert.deepEqual(filtersFromKey(key), { types: ["stock", "etf"], market: "India", exchange: "NSE" });
  assert.deepEqual(filtersFromKey(filterKeyOf()), { types: undefined, market: undefined, exchange: undefined });
});

test("results describe their asset class in words", () => {
  assert.equal(assetLabel({ type: "stock", market: "India" }), "Indian stock");
  assert.equal(assetLabel({ type: "etf", market: "US" }), "US ETF");
  assert.equal(assetLabel({ type: "commodity", market: "India" }), "Commodity future");
  assert.equal(assetLabel({ type: "index", market: "Global" }), "Index");
});

/* ------------------------------------------------------------ portfolio pick */

test("a picked result is stored by its canonical symbol", () => {
  assert.equal(storedSymbolFor({ symbol: "SBIN", type: "stock", market: "India" }), "SBIN");
  assert.equal(storedSymbolFor({ symbol: "SBICARD", type: "stock", market: "India" }), "SBICARD.NS");
  assert.equal(storedSymbolFor({ symbol: "GOLDBEES", type: "etf", market: "India" }), "GOLDBEES.NS");
  assert.equal(storedSymbolFor({ symbol: "AAPL", type: "stock", market: "US" }), "AAPL");
  assert.equal(storedSymbolFor({ symbol: "btc", type: "crypto", market: "Global" }), "BTC");
});

test("a holding needs a picked stock or ETF; typed text alone is refused", () => {
  assert.match(holdingInstrumentError(null) ?? "", /Pick a stock or ETF/);
  assert.match(holdingInstrumentError({ symbol: "NIFTY", type: "index" }) ?? "", /stocks or ETFs/);
  assert.equal(holdingInstrumentError({ symbol: "SBIN", type: "stock" }), null);
  assert.equal(holdingInstrumentError({ symbol: "SBICARD.NS", type: "stock" }), null);
  // An existing record being edited only knows its symbol.
  assert.equal(holdingInstrumentError({ symbol: "TCS" }), null);
});

test("search results flow into a holding: SBI → pick SBI Cards → SBICARD.NS", async () => {
  const { results } = await createInstrumentSearch(deps())("SBI", 10, { types: HOLDING_TYPES });
  const cards = results.find((r) => r.symbol === "SBICARD");
  assert.ok(cards);
  const stored = storedSymbolFor(cards);
  assert.equal(stored, "SBICARD.NS");
  assert.equal(holdingInstrumentError({ symbol: stored, type: cards.type }), null);
});
