import { test } from "node:test";
import assert from "node:assert/strict";

import type { AssetQuote } from "@/lib/types/quote";
import {
  HOME_MOVERS_PER_SIDE,
  MARKET_MOVERS_UNIVERSE,
  MARKET_MOVERS_UNIVERSE_LABEL,
  loadMarketMovers,
  summariseMarketMovers,
} from "../marketMovers";

// These are the ranking rules themselves, tested without a provider in sight.
// /api/market/movers and the Agent's get_market_movers tool both call this
// function, so a rule proven here holds for both of them — which is the point
// of the extraction: the panel and the assistant cannot disagree about who the
// top gainer is.

/** A quote carrying every field the real provider sets, so trimming shows up. */
function quote(symbol: string, changePercent: number, price = 100): AssetQuote {
  return {
    symbol,
    price,
    change: changePercent,
    changePercent,
    open: 99,
    high: 101,
    low: 98,
    previousClose: 100,
    volume: 1_000,
    currency: "INR",
    lastUpdated: "2026-10-01T09:15:00.000Z",
  };
}

const symbolsOf = (quotes: AssetQuote[]) => quotes.map((entry) => entry.symbol);

test("breadth, direction and both rankings follow from the change percentages", () => {
  const summary = summariseMarketMovers(
    [
      quote("A", 2.5),
      quote("B", -1.5),
      quote("C", 0),
      quote("D", 4),
      quote("E", -3.25),
      quote("F", 0.5),
    ],
    2
  );

  assert.equal(summary.universe, MARKET_MOVERS_UNIVERSE);
  assert.equal(summary.totalStocks, 6);
  assert.equal(summary.advancing, 3);
  assert.equal(summary.declining, 2);
  assert.equal(summary.unchanged, 1);
  assert.equal(summary.direction, "BULLISH");
  assert.equal(summary.breadthPercent, 50);

  // Strongest gainer first, steepest faller first.
  assert.deepEqual(symbolsOf(summary.gainers), ["D", "A"]);
  assert.deepEqual(symbolsOf(summary.losers), ["E", "B"]);
});

test("the Home panel's depth is the default, and a larger or smaller one is honoured", () => {
  const quotes = Array.from({ length: 8 }, (_, index) => quote(`G${index}`, index + 1));

  assert.equal(HOME_MOVERS_PER_SIDE, 3);
  assert.equal(summariseMarketMovers(quotes).gainers.length, 3);
  assert.equal(summariseMarketMovers(quotes, 8).gainers.length, 8);
  assert.equal(summariseMarketMovers(quotes, 1).gainers.length, 1);
});

test("a nonsensical depth cannot reach slice(): it is clamped, not counted backwards", () => {
  const quotes = Array.from({ length: 5 }, (_, index) => quote(`G${index}`, index + 1));

  // Array.prototype.slice treats a negative argument as an offset from the end,
  // so an unclamped -1 would silently return four movers instead of none.
  assert.deepEqual(summariseMarketMovers(quotes, -1).gainers, []);
  assert.deepEqual(summariseMarketMovers(quotes, -1).losers, []);
  assert.equal(summariseMarketMovers(quotes, 2.7).gainers.length, 2);
  assert.equal(summariseMarketMovers(quotes, Number.NaN).gainers.length, HOME_MOVERS_PER_SIDE);
});

test("a flat or empty market is NEUTRAL with no movers, never an invented one", () => {
  const flat = summariseMarketMovers([quote("X", 0), quote("Y", 0)]);

  assert.equal(flat.direction, "NEUTRAL");
  assert.deepEqual(flat.gainers, []);
  assert.deepEqual(flat.losers, []);
  assert.equal(flat.unchanged, 2);

  const empty = summariseMarketMovers([]);
  assert.equal(empty.direction, "NEUTRAL");
  assert.equal(empty.breadthPercent, 0);
  assert.equal(empty.totalStocks, 0);
});

test("a declining market is BEARISH and a missing change counts as unchanged", () => {
  const bearish = summariseMarketMovers([
    quote("A", -1),
    quote("B", -2),
    quote("C", 0.5),
  ]);

  assert.equal(bearish.direction, "BEARISH");
  assert.deepEqual(symbolsOf(bearish.losers), ["B", "A"]);

  // changePercent is optional on AssetQuote; absent means "no movement
  // reported", which is not a gain and not a loss.
  const missing: AssetQuote = { symbol: "Z", price: 10 };
  const summary = summariseMarketMovers([missing]);

  assert.equal(summary.unchanged, 1);
  assert.deepEqual(summary.gainers, []);
  assert.deepEqual(summary.losers, []);
});

test("loadMarketMovers reports an unavailable provider as null, never an empty ranking", async () => {
  // getNifty50Quotes() reports a transport error, an HTTP error and an
  // unnormalisable payload identically — as []. For a universe that is
  // definitely not empty, that is an outage, and null is how it is told apart
  // from "the market was genuinely quiet".
  assert.equal(await loadMarketMovers(async () => []), null);

  const summary = await loadMarketMovers(async () => [quote("A", 1)]);
  assert.equal(summary?.advancing, 1);
  assert.equal(summary?.universe, MARKET_MOVERS_UNIVERSE);
});

test("the universe has one spelling for the wire and one for a person", () => {
  assert.equal(MARKET_MOVERS_UNIVERSE, "NIFTY_50");
  assert.equal(MARKET_MOVERS_UNIVERSE_LABEL, "Nifty 50 (NSE, India)");
});

test("a throwing quote loader propagates, so each caller chooses its own failure", async () => {
  // The route turns this into its 500; the Agent tool turns it into ok:false.
  // Swallowing it here would decide that for both of them.
  await assert.rejects(
    loadMarketMovers(async () => {
      throw new Error("kaboom");
    }),
    /kaboom/
  );
});
