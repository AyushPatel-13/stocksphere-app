import { test } from "node:test";
import assert from "node:assert/strict";

import type { FinnhubSymbolMatch } from "../../apis/finnhub";
import type { UpstoxEquityCandidate } from "../../apis/upstox";
import { isIndianEquitySymbol } from "../../data/instruments/india";
import { createSymbolResolverTool } from "../../agent/tools/symbolResolverTool";
import { createInstrumentSearch } from "../instruments";
import { isRetiredSymbol, retiredListing } from "../renames";

// What the providers returned for these names on 28 Oct 2026, trimmed. Upstox
// may still list the old TATAMOTORS row; it must never be offered.
const UPSTOX: UpstoxEquityCandidate[] = [
  { trading_symbol: "INFY", name: "INFOSYS LIMITED" },
  { trading_symbol: "ETERNAL", name: "ETERNAL LIMITED" },
  { trading_symbol: "TMCV", name: "TATA MOTORS LIMITED" },
  { trading_symbol: "TMPV", name: "TATA MOTORS PASS VEH LTD" },
  { trading_symbol: "TATAMOTORS", name: "TATA MOTORS LTD" },
] as UpstoxEquityCandidate[];

const FINNHUB: FinnhubSymbolMatch[] = [
  { symbol: "F", description: "FORD MOTOR CO", type: "Common Stock" },
  { symbol: "AAPL", description: "APPLE INC", type: "Common Stock" },
  { symbol: "INFY", description: "INFOSYS LTD-SP ADR", type: "ADR" },
];

const containing = <T>(rows: T[], text: (row: T) => string) => async (query: string) =>
  rows.filter((row) => text(row).toLowerCase().includes(query.toLowerCase()));

const searchIndian = containing(UPSTOX, (row) => `${row.trading_symbol} ${row.name}`);
const searchUs = containing(FINNHUB, (row) => `${row.symbol} ${row.description}`);

const search = createInstrumentSearch({ searchIndian, searchUs, now: () => 0 });
const resolver = createSymbolResolverTool(searchIndian, searchUs);

const symbols = async (query: string) => (await search(query)).results.map((result) => result.symbol);

test("retired listings are found by old symbol or old name, in any spelling", () => {
  assert.equal(retiredListing("TATAMOTORS")?.successors.length, 2);
  assert.equal(retiredListing("tatamotors.ns")?.symbol, "TATAMOTORS");
  assert.equal(retiredListing("  Tata   Motors ")?.symbol, "TATAMOTORS");
  assert.equal(retiredListing("Zomato")?.successors[0].symbol, "ETERNAL");
  assert.equal(retiredListing("Tata Steel"), null);
  assert.equal(retiredListing(""), null);
  assert.ok(isRetiredSymbol("ZOMATO.NS"));
  assert.ok(!isRetiredSymbol("ETERNAL"));
});

test("search: old names lead to the listings that trade now, never the dead ticker", async () => {
  const tata = await symbols("Tata Motors");
  assert.ok(tata.includes("TMPV") && tata.includes("TMCV"), tata.join());
  assert.ok(!tata.includes("TATAMOTORS"), tata.join());

  assert.deepEqual((await symbols("TATAMOTORS")).filter((s) => s.startsWith("TM")).sort(), ["TMCV", "TMPV"]);
  assert.equal((await symbols("Zomato"))[0], "ETERNAL");
  assert.equal((await symbols("Eternal"))[0], "ETERNAL");
});

test("a bare TMCV is an Indian listing, not the unrelated US ticker", () => {
  assert.ok(isIndianEquitySymbol("TMCV"));
  assert.ok(isIndianEquitySymbol("TMPV"));
});

test("the AI resolver: Ford is F, a demerger is a choice, a rename is a match", async () => {
  const ford = await resolver.execute({ query: "Ford" });
  assert.equal(ford.data?.bestMatch?.symbol, "F");

  const tata = await resolver.execute({ query: "Tata Motors" });
  assert.deepEqual(tata.data?.candidates.map((c) => c.symbol), ["TMPV.NS", "TMCV.NS"]);
  assert.equal(tata.data?.bestMatch, null);
  assert.match(tata.data?.note ?? "", /demerged/);

  const zomato = await resolver.execute({ query: "zomato" });
  assert.equal(zomato.data?.bestMatch?.symbol, "ETERNAL.NS");

  // Without a US search (tests that inject only Upstox) nothing US is asked for.
  const indianOnly = await createSymbolResolverTool(searchIndian).execute({ query: "Ford" });
  assert.ok(!indianOnly.data?.candidates.some((c) => c.symbol === "F"));
});

test("search and the AI agree on Ford, Apple, Infosys, Tata Motors, Zomato and Eternal", async () => {
  const bare = (symbol: string | undefined) => symbol?.replace(/\.NS$/, "");
  for (const name of ["Ford", "Apple", "Infosys", "Zomato", "Eternal"]) {
    const ai = await resolver.execute({ query: name });
    assert.equal(bare(ai.data?.bestMatch?.symbol), (await symbols(name))[0], name);
  }
  // A demerger has no single answer; both list the same two listings.
  const ai = (await resolver.execute({ query: "Tata Motors" })).data?.candidates.map((c) => bare(c.symbol)).sort();
  const box = (await symbols("Tata Motors")).filter((s) => s === "TMPV" || s === "TMCV").sort();
  assert.deepEqual(ai, box);
});
