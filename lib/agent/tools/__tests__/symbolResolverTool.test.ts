import { test } from "node:test";
import assert from "node:assert/strict";
import { stocks } from "@/lib/stocks";
import type { UpstoxEquityCandidate } from "@/lib/apis/upstox";
import {
  companyNameTokens,
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

test("ranking: an exact company-name match outranks a name that merely contains the query", async () => {
  // The "Compare TCS and Infosys." case. Both names contain "infosys", but only
  // one IS Infosys, and returning them at the same rank made the agent stop and
  // ask which one was meant instead of answering.
  const { search } = fakeSearch([
    row("HCL-INSYS", "HCL Infosystems Ltd"),
    row("INFY", "Infosys"),
  ]);
  const tool = createSymbolResolverTool(search);

  const result = await tool.execute({ query: "Infosys" });

  assert.equal(result.data?.candidates[0].symbol, "INFY.NS");
  assert.equal(result.data?.candidates[1].symbol, "HCL-INSYS.NS");
});

// --- Natural company names ------------------------------------------------------------------
//
// Upstox stores the legal name ("Reliance Industries Ltd."), so a query a person
// would call the exact company name is only ever a *token* match against it. The
// rows below use the real registry spellings, because fixtures with tidy names
// ("Infosys") hid a production bug: with the real "Infosys Ltd", INFY and
// HCL-INSYS both merely contained "infosys" and tied, so HCL Infosystems came
// back first for a search that named Infosys.

const relianceRows = [
  row("RPOWER", "Reliance Power Ltd."),
  row("RIIL", "Reliance Industrial Infrastructure Ltd."),
  row("RELCHEMQ", "Reliance Chemotex Industries Ltd."),
  row("RELIANCE", "Reliance Industries Ltd."),
];

test("'Reliance' resolves to RELIANCE, not to another Reliance-named company", async () => {
  const { search } = fakeSearch(relianceRows);
  const tool = createSymbolResolverTool(search);

  const result = await tool.execute({ query: "Reliance" });

  assert.equal(result.data?.candidates[0].symbol, "RELIANCE.NS");
  assert.equal(result.data?.candidates[0].name, "Reliance Industries Ltd.");
});

test("'Reliance Industries' resolves to RELIANCE: the legal form is the only difference", async () => {
  const { search } = fakeSearch(relianceRows);
  const tool = createSymbolResolverTool(search);

  const result = await tool.execute({ query: "Reliance Industries" });

  assert.equal(result.data?.candidates[0].symbol, "RELIANCE.NS");
  // ...and the companies that merely share the first word stay behind it.
  assert.deepEqual(symbolsOf(result.data?.candidates).slice(1), [
    "RPOWER.NS",
    "RIIL.NS",
    "RELCHEMQ.NS",
  ]);
});

test("'Infosys' beats 'HCL Infosystems' against the names the registry actually stores", async () => {
  const { search } = fakeSearch([row("HCL-INSYS", "HCL Infosystems Ltd"), row("INFY", "Infosys Ltd")]);
  const tool = createSymbolResolverTool(search);

  const byName = await tool.execute({ query: "Infosys" });
  const byTicker = await tool.execute({ query: "INFY" });

  assert.deepEqual(symbolsOf(byName.data?.candidates), ["INFY.NS", "HCL-INSYS.NS"]);
  assert.equal(byTicker.data?.candidates[0].symbol, "INFY.NS");
});

test("'Tata Consultancy Services' resolves to TCS against the stored legal name", async () => {
  const { search } = fakeSearch([
    row("TATAFAKE", "Tata Fake Industries Ltd"),
    row("TCS", "Tata Consultancy Services Ltd"),
  ]);
  const tool = createSymbolResolverTool(search);

  const result = await tool.execute({ query: "Tata Consultancy Services" });

  assert.equal(result.data?.candidates[0].symbol, "TCS.NS");
});

test("'HDFC Bank' and 'ICICI Bank' resolve to their own bank, not to a sibling with the same first word", async () => {
  const bankSearch = fakeSearch([
    row("HDFCLIFE", "HDFC Life Insurance Company Ltd"),
    row("HDFCBANK", "HDFC Bank Ltd"),
  ]).search;
  const iciciSearch = fakeSearch([
    row("ICICIGI", "ICICI Lombard General Insurance Company Ltd"),
    row("ICICIBANK", "ICICI Bank Ltd"),
  ]).search;

  const hdfc = await createSymbolResolverTool(bankSearch).execute({ query: "HDFC Bank" });
  const icici = await createSymbolResolverTool(iciciSearch).execute({ query: "ICICI Bank" });

  assert.equal(hdfc.data?.candidates[0].symbol, "HDFCBANK.NS");
  assert.equal(icici.data?.candidates[0].symbol, "ICICIBANK.NS");
});

test("genuinely ambiguous queries stay ambiguous rather than silently picking one", async () => {
  // Three real companies begin with "Tata". None of them IS "Tata", so the
  // resolver must not promote one of them to a confident single answer.
  const { search } = fakeSearch([
    row("TATAMOTORS", "Tata Motors Ltd"),
    row("TATASTEEL", "Tata Steel Ltd"),
    row("TCS", "Tata Consultancy Services Ltd"),
  ]);
  const tool = createSymbolResolverTool(search);

  const result = await tool.execute({ query: "Tata" });

  assert.deepEqual(symbolsOf(result.data?.candidates), [
    "TATAMOTORS.NS",
    "TATASTEEL.NS",
    "TCS.NS",
  ]);
  assert.equal(result.data?.authoritative, false);
});

test("a distinctive word is never stripped: 'Reliance Power' is not 'Reliance Industries'", async () => {
  const { search } = fakeSearch(relianceRows);
  const tool = createSymbolResolverTool(search);

  const result = await tool.execute({ query: "Reliance Power" });

  // Only one candidate matches the whole name; the others fall back to search
  // order rather than being promoted by the shared first word.
  assert.equal(result.data?.candidates[0].symbol, "RPOWER.NS");
  assert.ok(symbolsOf(result.data?.candidates).includes("RELIANCE.NS"));
  assert.notEqual(result.data?.candidates[1].symbol, "RELIANCE.NS");
});

test("companyNameTokens drops punctuation and only trailing legal forms", () => {
  assert.deepEqual(companyNameTokens("Reliance Industries Ltd."), ["reliance", "industries"]);
  assert.deepEqual(companyNameTokens("HDFC Bank Ltd"), ["hdfc", "bank"]);
  assert.deepEqual(companyNameTokens("Infosys"), ["infosys"]);
  assert.deepEqual(companyNameTokens("Mahindra & Mahindra Ltd"), ["mahindra", "mahindra"]);
  assert.deepEqual(companyNameTokens("HCL Infosystems Ltd"), ["hcl", "infosystems"]);

  // "Industries", "Power", "Motors" distinguish companies and must survive.
  assert.deepEqual(companyNameTokens("Reliance Power Ltd"), ["reliance", "power"]);
  assert.deepEqual(companyNameTokens("Tata Motors Limited"), ["tata", "motors"]);

  // A legal form in the middle is part of the name; only the end is decoration.
  assert.deepEqual(companyNameTokens("Limited Brands Inc"), ["limited", "brands"]);
  assert.deepEqual(companyNameTokens("Ltd"), []);
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
