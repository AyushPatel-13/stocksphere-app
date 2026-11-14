import { test } from "node:test";
import assert from "node:assert/strict";

import { GET } from "@/app/api/screener/fundamentals/route";
import { buildScreenerFundamentals } from "@/lib/services/screenerFundamentals";
import { NIFTY_50_SYMBOLS } from "@/lib/data/instruments/india";
import { EMPTY_CRITERIA, US_LARGE_CAPS, applyScreen, deriveFundamentals, formatCap, normaliseCriteria, sortScreen, type ScreenInput } from "../screener";

/** Screener fundamentals: P/E, market cap and sector filters that never pass a stock on a missing figure. */

const row = (symbol: string, market: "india" | "us", price: number | null, extra: Partial<ScreenInput> = {}): ScreenInput => ({
  symbol,
  name: symbol,
  currency: market === "india" ? "INR" : "USD",
  price,
  change: 0,
  changePercent: 0,
  volume: 1000,
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  spark: [],
  asOf: null,
  source: "Yahoo",
  market,
  ...extra,
});

const universe: ScreenInput[] = [
  row("BANK", "india", 800, { sector: "Financial Services", marketCap: 12e12, pe: 20 }),
  row("OIL", "india", 1300, { sector: "Oil Gas & Consumable Fuels", marketCap: 18e12, pe: 12 }),
  row("SMALL", "india", 100, { sector: "Financial Services", marketCap: 4e11, pe: 8 }),
  row("LOSS", "india", 50, { sector: "Financial Services", marketCap: 9e11, pe: null }),
  row("UNKNOWN", "india", 60),
  row("BIGTECH", "us", 350, { sector: null, marketCap: 3.5e12, pe: 35 }),
  row("USVALUE", "us", 90, { sector: null, marketCap: 2e11, pe: 11 }),
];
const symbols = (criteria: Partial<typeof EMPTY_CRITERIA>) => applyScreen(universe, { ...EMPTY_CRITERIA, ...criteria }).map((r) => r.symbol);

test("P/E filters keep only companies with a known, positive P/E in range", () => {
  assert.deepEqual(symbols({ maxPe: 15 }), ["OIL", "SMALL", "USVALUE"]);
  assert.deepEqual(symbols({ minPe: 15 }), ["BANK", "BIGTECH"]);
  assert.deepEqual(symbols({ minPe: 10, maxPe: 20 }), ["BANK", "OIL", "USVALUE"]);
  // A loss-maker and a stock with no fundamentals never pass a P/E bound, in either direction.
  for (const criteria of [{ maxPe: 1000 }, { minPe: 0 }]) {
    const matched = symbols(criteria);
    assert.equal(matched.includes("LOSS"), false);
    assert.equal(matched.includes("UNKNOWN"), false);
  }
  assert.deepEqual(applyScreen(universe, { ...EMPTY_CRITERIA, maxPe: 15 })[0].reasons, ["P/E 12.0 ≤ 15"]);
});

test("a market-cap floor is in its own market's unit and only judges that market", () => {
  // ₹1,00,000 Cr = 1e12: BANK and OIL pass; SMALL and LOSS don't; UNKNOWN has no cap. US rows aren't judged by a rupee floor.
  assert.deepEqual(symbols({ minMarketCapCr: 100_000 }), ["BANK", "OIL", "BIGTECH", "USVALUE"]);
  assert.deepEqual(symbols({ minMarketCapCr: 100_000, market: "india" }), ["BANK", "OIL"]);
  // $1,000B: only BIGTECH among US rows; Indian rows untouched.
  assert.deepEqual(symbols({ minMarketCapUsdBn: 1000 }), ["BANK", "OIL", "SMALL", "LOSS", "UNKNOWN", "BIGTECH"]);
  assert.deepEqual(symbols({ minMarketCapCr: 100_000, minMarketCapUsdBn: 1000 }), ["BANK", "OIL", "BIGTECH"]);
  assert.deepEqual(applyScreen(universe, { ...EMPTY_CRITERIA, minMarketCapCr: 100_000 })[0].reasons, ["market cap ₹12.00 L Cr ≥ ₹1,00,000 Cr"]);
  assert.deepEqual(applyScreen(universe, { ...EMPTY_CRITERIA, minMarketCapUsdBn: 1000, market: "us" })[0].reasons, ["market cap $3.50T ≥ $1000B"]);
});

test("a sector filter matches NSE's sector exactly; stocks without one never match", () => {
  assert.deepEqual(symbols({ sector: "Financial Services" }), ["BANK", "SMALL", "LOSS"]);
  assert.deepEqual(symbols({ sector: "Financial Services", maxPe: 10 }), ["SMALL"]);
  assert.deepEqual(symbols({ sector: "Textiles" }), []);
  // No fundamentals filter set: every priced stock is listed, known figures or not.
  assert.equal(symbols({}).length, 7);
});

test("market cap and P/E sort with unknowns last in either direction", () => {
  const all = applyScreen(universe, EMPTY_CRITERIA);
  assert.deepEqual(sortScreen(all, "pe", false).map((r) => r.symbol), ["SMALL", "USVALUE", "OIL", "BANK", "BIGTECH", "LOSS", "UNKNOWN"]);
  assert.deepEqual(sortScreen(all, "pe", true).map((r) => r.symbol).slice(0, 2), ["BIGTECH", "BANK"]);
  assert.deepEqual(sortScreen(all, "pe", true).map((r) => r.symbol).slice(-2), ["LOSS", "UNKNOWN"]);
  assert.equal(sortScreen(all, "marketCap", true)[0].symbol, "OIL");
  assert.equal(sortScreen(all, "marketCap", false).at(-1)?.symbol, "UNKNOWN");
});

test("market cap and P/E come from the price shown, and only from sourced figures", () => {
  const f = { sector: "Financial Services", sharesOutstanding: 15e9, netIncomeFy: 6e11 };
  assert.deepEqual(deriveFundamentals(800, f), { sector: "Financial Services", marketCap: 12e12, pe: 20 });
  // No reported profit, no price, or no fundamentals: the figure is absent, not zero.
  assert.deepEqual(deriveFundamentals(800, { ...f, netIncomeFy: null }), { sector: "Financial Services", marketCap: 12e12, pe: null });
  assert.deepEqual(deriveFundamentals(800, { ...f, sharesOutstanding: null }), { sector: "Financial Services", marketCap: null, pe: null });
  assert.deepEqual(deriveFundamentals(null, f), { sector: "Financial Services", marketCap: null, pe: null });
  assert.deepEqual(deriveFundamentals(800, undefined), { sector: null, marketCap: null, pe: null });
  assert.deepEqual(deriveFundamentals(800, { sector: null, sharesOutstanding: null, netIncomeFy: null }), { sector: null, marketCap: null, pe: null });
  assert.equal(formatCap(17.92e12, "INR"), "₹17.92 L Cr");
  assert.equal(formatCap(807.75e9, "INR"), "₹80,775 Cr");
  assert.equal(formatCap(3.52e12, "USD"), "$3.52T");
  assert.equal(formatCap(36.3e9, "USD"), "$36.30B");
});

test("a screen saved before these filters existed still loads, and junk is dropped", () => {
  const old = { market: "india", minChangePct: 1, maxChangePct: null, withinOfHighPct: null, withinOfLowPct: null, minVolume: null };
  assert.deepEqual(normaliseCriteria(old), { ...EMPTY_CRITERIA, market: "india", minChangePct: 1 });
  assert.deepEqual(normaliseCriteria({ market: "mars", maxPe: "15", minPe: NaN, sector: "  ", evil: "<script>" }), EMPTY_CRITERIA);
  assert.deepEqual(normaliseCriteria({ maxPe: 15, sector: " Financial Services " }), { ...EMPTY_CRITERIA, maxPe: 15, sector: "Financial Services" });
  for (const junk of [null, undefined, "x", 5, []]) assert.deepEqual(normaliseCriteria(junk), EMPTY_CRITERIA);
});

test("the universe's fundamentals: sectors from NSE, shares and EPS from Yahoo, gaps left as gaps", async () => {
  const asked: string[] = [];
  const built = await buildScreenerFundamentals({
    constituents: async () => ({
      constituents: [
        { symbol: "RELIANCE", name: "Reliance", sector: "Oil Gas & Consumable Fuels", isin: "x" },
        { symbol: "HDFCBANK", name: "HDFC Bank", sector: "Financial Services", isin: "y" },
      ],
      fetchedAt: "2026-11-14T00:00:00.000Z",
      source: "NSE Indices constituent list",
    }),
    fundamentals: async (yahoo) => {
      asked.push(yahoo);
      if (yahoo === "RELIANCE.NS") return { sharesOutstanding: { value: 13.53e9, asOf: "2026-03-31" }, epsTtm: { value: 60.68, asOf: "2026-09-30" }, netIncomeFy: { value: 807.75e9, asOf: "2026-03-31" }, currency: "INR" };
      if (yahoo === "AAPL") return { sharesOutstanding: { value: 14.7e9, asOf: "2026-09-30" }, epsTtm: null, netIncomeFy: null, currency: "USD" };
      if (yahoo === "TCS.NS") throw new Error("yahoo 429");
      return null;
    },
    now: () => Date.parse("2026-11-14T06:00:00Z"),
  });
  assert.ok(built);
  assert.equal(asked.length, NIFTY_50_SYMBOLS.length + US_LARGE_CAPS.length); // every stock in the universe is asked for once
  assert.equal(new Set(asked).size, asked.length);
  assert.ok(asked.includes("RELIANCE.NS") && asked.includes("AAPL"));
  assert.deepEqual(built.bySymbol.RELIANCE, { sector: "Oil Gas & Consumable Fuels", sharesOutstanding: 13.53e9, netIncomeFy: 807.75e9 });
  assert.deepEqual(built.bySymbol.HDFCBANK, { sector: "Financial Services", sharesOutstanding: null, netIncomeFy: null });
  assert.deepEqual(built.bySymbol.AAPL, { sector: null, sharesOutstanding: 14.7e9, netIncomeFy: null });
  assert.deepEqual(built.bySymbol.TCS, { sector: null, sharesOutstanding: null, netIncomeFy: null });
  assert.deepEqual(built.sectors, ["Financial Services", "Oil Gas & Consumable Fuels"]);
  assert.match(built.sectorSource ?? "", /NSE sector classification/);

  // Nothing reachable at all: unavailable, not a table of blanks.
  assert.equal(await buildScreenerFundamentals({ constituents: async () => null, fundamentals: async () => null, now: () => 0 }), null);
  assert.equal((await GET(undefined, undefined, async () => null)).status, 503);
  const ok = await GET(undefined, undefined, async () => built);
  assert.deepEqual([ok.status, (await ok.json()).source], [200, "Yahoo Finance"]);
});
