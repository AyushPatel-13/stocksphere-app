import { test } from "node:test";
import assert from "node:assert/strict";
import { stocks } from "@/lib/stocks";
import type { UpstoxEquityCandidate } from "@/lib/apis/upstox";
import {
  createSymbolResolverTool,
  stripIndianSuffix,
  symbolResolverTool,
  toCanonicalSymbol,
  type IndianCandidateSearch,
} from "../symbolResolverTool";

// Every test below injects a fake Indian candidate search, so nothing here can
// reach Upstox (or need UPSTOX_ACCESS_TOKEN), even if a token is set in the shell.

// Mirrors the routing rule in lib/providers/market.provider.ts
// (isIndianSymbol is not exported): ".NS"/".BSE" suffix => Upstox path.
const routesToIndianPath = (symbol: string) =>
  symbol.endsWith(".NS") || symbol.endsWith(".BSE");

// The US/global entries currently in lib/stocks.ts. If a new stock is added
// to lib/stocks.ts, the drift-guard test below fails until it is classified
// (Indian => add to INDIAN_SYMBOLS in symbolResolverTool.ts; otherwise add here).
const KNOWN_GLOBAL_SYMBOLS = ["AAPL", "MSFT", "GOOGL", "NVDA", "TSLA", "AMZN", "META", "NFLX"];

const TCS_KEY = "NSE_EQ|INE467B01029";

function row(
  trading_symbol: string,
  name: string | undefined,
  overrides: Partial<UpstoxEquityCandidate> = {}
): UpstoxEquityCandidate {
  return {
    trading_symbol,
    instrument_key: `NSE_EQ|KEY_${trading_symbol}`,
    segment: "NSE_EQ",
    instrument_type: "EQ",
    exchange: "NSE",
    isin: `ISIN_${trading_symbol}`,
    ...(name !== undefined && { name }),
    ...overrides,
  };
}

const tcsRow = row("TCS", "TATA CONSULTANCY SERVICES LTD", {
  instrument_key: TCS_KEY,
  isin: "INE467B01029",
  short_name: "TCS",
});

/** Fake search that returns fixed rows and records the queries it received. */
function fakeSearch(rows: UpstoxEquityCandidate[] | null) {
  const calls: string[] = [];
  const search: IndianCandidateSearch = async (query) => {
    calls.push(query);
    return rows;
  };
  return { search, calls };
}

const unavailable: IndianCandidateSearch = async () => null;
const throwing: IndianCandidateSearch = async () => {
  throw new Error("UPSTOX_ACCESS_TOKEN is missing from environment variables");
};

const symbolsOf = (candidates: { symbol: string }[] | undefined) =>
  (candidates ?? []).map((c) => c.symbol);

// --- Indian queries via Upstox ---------------------------------------------

test("exact ticker 'TCS': searches Upstox and returns the canonical TCS.NS first", async () => {
  const { search, calls } = fakeSearch([tcsRow]);
  const tool = createSymbolResolverTool(search);

  const result = await tool.execute({ query: "TCS" });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["TCS"]);
  assert.equal(result.data?.candidates[0].symbol, "TCS.NS");
  assert.equal(result.data?.authoritative, false);
});

test("'TCS.NS': the suffix is stripped before the Upstox search and the output stays TCS.NS", async () => {
  const { search, calls } = fakeSearch([tcsRow]);
  const tool = createSymbolResolverTool(search);

  const result = await tool.execute({ query: "TCS.NS" });

  assert.deepEqual(calls, ["TCS"]);
  assert.equal(result.data?.candidates[0].symbol, "TCS.NS");
});

test("suffix stripping is case-insensitive and also handles .BSE (output is still NSE-canonical)", async () => {
  const { search, calls } = fakeSearch([tcsRow]);
  const tool = createSymbolResolverTool(search);

  const lower = await tool.execute({ query: "tcs.ns" });
  const bse = await tool.execute({ query: "TCS.BSE" });

  assert.deepEqual(calls, ["tcs", "TCS"]);
  assert.equal(lower.data?.candidates[0].symbol, "TCS.NS");
  assert.equal(bse.data?.candidates[0].symbol, "TCS.NS");
});

test("company name 'Tata Consultancy': searched as free text and resolves to TCS.NS", async () => {
  const { search, calls } = fakeSearch([row("TATAFAKE", "TATA FAKE INDUSTRIES LTD"), tcsRow]);
  const tool = createSymbolResolverTool(search);

  const result = await tool.execute({ query: "Tata Consultancy" });

  assert.deepEqual(calls, ["Tata Consultancy"]);
  assert.equal(result.data?.candidates[0].symbol, "TCS.NS");
});

// --- Ranking, dedupe, cap ---------------------------------------------------

test("ranking: exact symbol, then symbol prefix, then name match, then the rest", async () => {
  // Deliberately returned in the "wrong" order.
  const { search } = fakeSearch([
    row("QQQ", "UNRELATED CORP"), //           tier 3: no relation to the query
    row("ZZZ", "ZZZ TCS HOLDINGS LTD"), //     tier 2: name contains "tcs"
    row("TCSFAKE", "TCSFAKE LTD"), //          tier 1: symbol prefix
    tcsRow, //                                 tier 0: exact symbol
  ]);
  const tool = createSymbolResolverTool(search);

  const result = await tool.execute({ query: "TCS" });

  assert.deepEqual(symbolsOf(result.data?.candidates), [
    "TCS.NS",
    "TCSFAKE.NS",
    "ZZZ.NS",
    "QQQ.NS",
  ]);
});

test("deduplication: the same symbol from Upstox (twice) and the local list appears once, with the Upstox name", async () => {
  const { search } = fakeSearch([tcsRow, tcsRow, row("tcs", "duplicate in lowercase")]);
  const tool = createSymbolResolverTool(search);

  const result = await tool.execute({ query: "TCS" });

  const tcsEntries = (result.data?.candidates ?? []).filter((c) => c.symbol === "TCS.NS");
  assert.equal(tcsEntries.length, 1);
  assert.equal(tcsEntries[0].name, "TATA CONSULTANCY SERVICES LTD");
});

test("candidates are capped at 5 and an exact match returned last by Upstox still ranks first", async () => {
  const many = Array.from({ length: 29 }, (_, i) => row(`AAA${i}`, `AAA COMPANY ${i}`));
  const { search } = fakeSearch([...many, tcsRow]);
  const tool = createSymbolResolverTool(search);

  const result = await tool.execute({ query: "TCS" });

  assert.equal(result.data?.candidates.length, 5);
  assert.equal(result.data?.candidates[0].symbol, "TCS.NS");
});

// --- Canonical output / no leakage -------------------------------------------

test("canonical output: every Upstox-derived symbol is upper-case and ends with .NS", async () => {
  const { search } = fakeSearch([row("infy", "INFOSYS LTD"), row("M&M", "MAHINDRA & MAHINDRA LTD")]);
  const tool = createSymbolResolverTool(search);

  const result = await tool.execute({ query: "in" });

  const symbols = symbolsOf(result.data?.candidates);
  assert.ok(symbols.includes("INFY.NS"));
  assert.ok(symbols.includes("M&M.NS"));
  for (const symbol of symbols.filter((s) => s === "INFY.NS" || s === "M&M.NS")) {
    assert.ok(symbol.endsWith(".NS"));
    assert.equal(symbol, symbol.toUpperCase());
  }
});

test("name fallback: uses short_name, then the trading symbol, when Upstox omits name", async () => {
  const { search } = fakeSearch([
    row("SHORTONLY", undefined, { short_name: "Short Only" }),
    row("BARE", undefined),
  ]);
  const tool = createSymbolResolverTool(search);

  const result = await tool.execute({ query: "zzz-no-local-match" });
  const byKey = Object.fromEntries((result.data?.candidates ?? []).map((c) => [c.symbol, c.name]));

  assert.equal(byKey["SHORTONLY.NS"], "Short Only");
  assert.equal(byKey["BARE.NS"], "BARE");
});

test("no leakage: instrument_key, ISIN and other Upstox fields never appear in the result", async () => {
  const { search } = fakeSearch([tcsRow, row("TCSFAKE", "TCSFAKE LTD")]);
  const tool = createSymbolResolverTool(search);

  const result = await tool.execute({ query: "TCS" });
  const serialized = JSON.stringify(result); // this is what the orchestrator sends to the LLM

  assert.ok(!serialized.includes("instrument_key"));
  assert.ok(!serialized.includes("NSE_EQ|"));
  assert.ok(!serialized.includes(TCS_KEY));
  assert.ok(!serialized.includes("INE467B01029"));
  assert.ok(!serialized.includes("isin"));
  for (const candidate of result.data?.candidates ?? []) {
    assert.deepEqual(Object.keys(candidate).sort(), ["name", "symbol"]);
  }
});

// --- Fail-soft fallback --------------------------------------------------------

test("Upstox failure (throws, e.g. missing token): falls back to the local list without throwing", async () => {
  const tool = createSymbolResolverTool(throwing);

  const result = await tool.execute({ query: "tcs" });

  assert.equal(result.ok, true);
  assert.deepEqual(symbolsOf(result.data?.candidates), ["TCS.NS"]);
  assert.equal(result.data?.candidates[0].name, "Tata Consultancy Services");
  assert.ok(!result.source.includes("Upstox"), "source must not claim Upstox was used");
});

test("Upstox unavailable (null) or malformed (non-array): falls back to the local list", async () => {
  const nullResult = await createSymbolResolverTool(unavailable).execute({ query: "tcs" });
  const malformed = await createSymbolResolverTool(
    (async () => ({ not: "an array" })) as unknown as IndianCandidateSearch
  ).execute({ query: "tcs" });

  for (const result of [nullResult, malformed]) {
    assert.equal(result.ok, true);
    assert.deepEqual(symbolsOf(result.data?.candidates), ["TCS.NS"]);
    assert.ok(!result.source.includes("Upstox"));
  }
});

test("source label mentions Upstox only when Upstox actually answered (even with zero rows)", async () => {
  const answered = await createSymbolResolverTool(fakeSearch([]).search).execute({ query: "tcs" });

  assert.ok(answered.source.includes("Upstox"));
  assert.deepEqual(symbolsOf(answered.data?.candidates), ["TCS.NS"]); // local still contributes
});

test("queries too long for Upstox (>50 chars) skip the Upstox call and use the local list only", async () => {
  const { search, calls } = fakeSearch([tcsRow]);
  const tool = createSymbolResolverTool(search);

  const result = await tool.execute({ query: "x".repeat(60) });

  assert.deepEqual(calls, []);
  assert.equal(result.ok, true);
  assert.ok(!result.source.includes("Upstox"));
});

test("a query that is only a suffix ('.NS') returns no candidates and does not call Upstox", async () => {
  const { search, calls } = fakeSearch([tcsRow]);
  const tool = createSymbolResolverTool(search);

  const result = await tool.execute({ query: ".NS" });

  assert.deepEqual(calls, []);
  assert.deepEqual(result.data?.candidates, []);
});

// --- US / global -----------------------------------------------------------------

test("US/global fallback: 'AAPL' and 'apple' still resolve from the local list, unsuffixed", async () => {
  for (const search of [unavailable, fakeSearch([]).search]) {
    const tool = createSymbolResolverTool(search);

    const byTicker = await tool.execute({ query: "AAPL" });
    const byName = await tool.execute({ query: "apple" });

    assert.equal(byTicker.data?.candidates[0].symbol, "AAPL");
    assert.ok(symbolsOf(byName.data?.candidates).includes("AAPL"));
    assert.ok(!symbolsOf(byTicker.data?.candidates).some((s) => s.endsWith(".NS")));
  }
});

test("US symbols are merged alongside Upstox rows without being suffixed", async () => {
  const { search } = fakeSearch([row("APPLEFAKE", "APPLE FAKE INDIA LTD")]);
  const tool = createSymbolResolverTool(search);

  const result = await tool.execute({ query: "apple" });
  const symbols = symbolsOf(result.data?.candidates);

  assert.ok(symbols.includes("AAPL"));
  assert.ok(symbols.includes("APPLEFAKE.NS"));
});

// --- Local-list behavior preserved (Upstox unavailable) -------------------------

test("local fallback: ticker match is case-insensitive and returns the canonical .NS symbol", async () => {
  const result = await createSymbolResolverTool(unavailable).execute({ query: "tcs" });

  assert.equal(result.ok, true);
  assert.equal(result.data?.authoritative, false);
  assert.ok(symbolsOf(result.data?.candidates).includes("TCS.NS"));
  assert.ok(!symbolsOf(result.data?.candidates).includes("TCS"));
});

test("local fallback: partial company name resolves, and the name is preserved", async () => {
  const result = await createSymbolResolverTool(unavailable).execute({ query: "tata cons" });

  const tcs = result.data?.candidates.find((c) => c.symbol === "TCS.NS");
  assert.equal(tcs?.name, "Tata Consultancy Services");
});

test("every stock in lib/stocks.ts resolves; Indian ones route to the Indian path and no US one does", async () => {
  const tool = createSymbolResolverTool(unavailable);

  for (const stock of stocks) {
    const result = await tool.execute({ query: stock.symbol });
    const candidate = result.data?.candidates.find((c) => c.name === stock.name);

    assert.ok(candidate, `expected a candidate for ${stock.symbol}`);
    assert.equal(
      routesToIndianPath(candidate.symbol),
      !KNOWN_GLOBAL_SYMBOLS.includes(stock.symbol),
      `${stock.symbol} -> ${candidate.symbol} routes incorrectly`
    );
  }
});

test("no match returns ok:true with an empty candidate list (not an error)", async () => {
  const result = await createSymbolResolverTool(fakeSearch([]).search).execute({
    query: "zzz-nonexistent-zzz",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data?.candidates, []);
});

test("candidates are capped at 5 and results are always non-authoritative", async () => {
  const result = await createSymbolResolverTool(unavailable).execute({ query: "a" });

  assert.ok((result.data?.candidates.length ?? 0) <= 5);
  assert.equal(result.data?.authoritative, false);
});

// --- Helpers / registration ---------------------------------------------------------

test("drift guard: every stock in lib/stocks.ts is classified as either Indian or known-global", () => {
  const unclassified = stocks
    .map((s) => s.symbol)
    .filter((symbol) => !KNOWN_GLOBAL_SYMBOLS.includes(symbol))
    .filter((symbol) => !toCanonicalSymbol(symbol).endsWith(".NS"));

  assert.deepEqual(unclassified, []);
});

test("toCanonicalSymbol is idempotent and does not double-suffix", () => {
  assert.equal(toCanonicalSymbol("TCS"), "TCS.NS");
  assert.equal(toCanonicalSymbol("TCS.NS"), "TCS.NS");
  assert.equal(toCanonicalSymbol("tcs.ns"), "TCS.NS");
  assert.equal(toCanonicalSymbol("TCS.BSE"), "TCS.BSE");
  assert.equal(toCanonicalSymbol("AAPL"), "AAPL");
});

test("stripIndianSuffix removes only a trailing .NS/.BSE", () => {
  assert.equal(stripIndianSuffix("TCS.NS"), "TCS");
  assert.equal(stripIndianSuffix("tcs.ns"), "tcs");
  assert.equal(stripIndianSuffix("TCS.BSE"), "TCS");
  assert.equal(stripIndianSuffix("Tata Consultancy"), "Tata Consultancy");
  assert.equal(stripIndianSuffix("BRK.B"), "BRK.B");
  assert.equal(stripIndianSuffix(".NS"), "");
});

test("the default export is the registered resolve_symbol tool", () => {
  assert.equal(symbolResolverTool.name, "resolve_symbol");
});
