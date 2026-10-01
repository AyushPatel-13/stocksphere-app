import { test } from "node:test";
import assert from "node:assert/strict";

import type { AssetQuote } from "@/lib/types/quote";
import { MARKET_MOVERS_UNIVERSE_LABEL } from "@/lib/services/marketMovers";
import { createMarketMoversTool, marketMoversTool } from "../marketMoversTool";

// "top 5 stocks today" — the question the Agent used to decline, because it had
// no ranking tool at all. The ranking itself is the existing Nifty 50 one
// (lib/services/marketMovers.ts, which /api/market/movers also calls); these
// tests are about what the Agent is handed, and about it being handed nothing
// rather than a plausible-looking list when the provider is down.
//
// Every test injects a fake quote loader, so nothing here reaches Upstox.

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

/** The quotes the tool and the endpoint must agree on. */
const MARKET = [
  quote("ADANIENT", -2.5, 3_100),
  quote("AXISBANK", -1.25, 1_180),
  quote("ITC", 0, 460),
  quote("RELIANCE", 0.75, 1_420),
  quote("TCS", 2.5, 4_100),
  quote("WIPRO", 3.75, 265),
];

const loaderFor = (quotes: AssetQuote[]) => async () => quotes;

test("the default answer is the top five each way, ranked by the change percentage", async () => {
  const tool = createMarketMoversTool(loaderFor(MARKET));
  const result = await tool.execute({});

  assert.equal(result.ok, true);
  assert.deepEqual(result.data?.gainers.map((mover) => mover.symbol), ["WIPRO", "TCS", "RELIANCE"]);
  assert.deepEqual(result.data?.losers.map((mover) => mover.symbol), ["ADANIENT", "AXISBANK"]);
  assert.ok(result.data);

  assert.equal(result.data.gainers[0].price, 265);
  assert.equal(result.data.gainers[0].changePercent, 3.75);
});

test("the requested limit is how many movers come back from each side", async () => {
  const many = Array.from({ length: 12 }, (_, index) => quote(`G${index}`, index + 1));
  const tool = createMarketMoversTool(loaderFor(many));

  assert.equal((await tool.execute({ limit: 5 })).data?.gainers.length, 5);
  assert.equal((await tool.execute({ limit: 1 })).data?.gainers.length, 1);
  assert.equal((await tool.execute({ limit: 10 })).data?.gainers.length, 10);
  assert.equal((await tool.execute({})).data?.gainers.length, 5, "five when no limit is given");
});

test("the universe is named in words, and the breadth figures come with it", async () => {
  const tool = createMarketMoversTool(loaderFor(MARKET));
  const data = (await tool.execute({})).data;

  // The model is told "Nifty 50 (NSE, India)", not the wire code the Home page
  // reads, so it cannot put "NIFTY_50" in front of a user.
  assert.equal(data?.universe, MARKET_MOVERS_UNIVERSE_LABEL);
  assert.equal(data?.totalStocks, 6);
  assert.equal(data?.advancing, 3);
  assert.equal(data?.declining, 2);
  assert.equal(data?.unchanged, 1);
  assert.equal(data?.direction, "BULLISH");
  assert.equal(data?.breadthPercent, 50);
});

test("only symbol, price and change reach the model: no other quote field is forwarded", async () => {
  const tool = createMarketMoversTool(loaderFor(MARKET));
  const result = await tool.execute({});

  for (const mover of [...(result.data?.gainers ?? []), ...(result.data?.losers ?? [])]) {
    assert.deepEqual(Object.keys(mover).sort(), ["changePercent", "price", "symbol"]);
  }

  const serialized = JSON.stringify(result);
  for (const field of ["previousClose", "volume", "currency", "lastUpdated", "instrument_key"]) {
    assert.ok(!serialized.includes(field), `${field} must not be forwarded`);
  }
});

test("a provider that answers with nothing is a failed tool, never an empty ranking", async () => {
  // getNifty50Quotes() turns a transport error, an HTTP error and an
  // unnormalisable payload into []. For the fixed Nifty 50 universe that is an
  // outage, and ok:true with two empty arrays would read as "nothing moved
  // today" — a claim this data cannot support.
  const tool = createMarketMoversTool(loaderFor([]));
  const result = await tool.execute({});

  assert.equal(result.ok, false);
  assert.equal(result.data, null);
  assert.ok(result.source.length > 0);
});

test("a throwing provider is a failed tool result, not an exception", async () => {
  const tool = createMarketMoversTool(async () => {
    throw new Error("UPSTOX_ACCESS_TOKEN is missing from environment variables");
  });

  const result = await tool.execute({});

  assert.equal(result.ok, false);
  assert.equal(result.data, null);
  assert.ok(!JSON.stringify(result).includes("UPSTOX"), "no upstream detail leaks");
});

test("a genuinely flat market produces no movers rather than a manufactured one", async () => {
  const tool = createMarketMoversTool(
    loaderFor([quote("A", 0), quote("B", 0), quote("C", 0)])
  );
  const data = (await tool.execute({})).data;

  assert.equal(data?.direction, "NEUTRAL");
  assert.deepEqual(data?.gainers, []);
  assert.deepEqual(data?.losers, []);
  assert.equal(data?.unchanged, 3);
});

test("the registered tool is get_market_movers and asks for no required argument", () => {
  assert.equal(marketMoversTool.name, "get_market_movers");
  assert.deepEqual(marketMoversTool.parameters.required, []);
  assert.equal(marketMoversTool.argsSchema.safeParse({}).success, true);
  assert.equal(marketMoversTool.argsSchema.safeParse({ limit: 10 }).success, true);
  assert.equal(marketMoversTool.argsSchema.safeParse({ limit: 0 }).success, false);
  assert.equal(marketMoversTool.argsSchema.safeParse({ limit: 11 }).success, false);
});

test("the tool and /api/market/movers rank the same quotes identically", async () => {
  // The reuse guarantee, stated as a test: the endpoint the Home page reads and
  // the tool the Agent calls are two views of one ranking, so they cannot drift
  // apart and tell the user two different things about the same market.
  const { GET } = await import("@/app/api/market/movers/route");

  const response = await GET(undefined, undefined, loaderFor(MARKET));
  const json = (await response.json()) as {
    success: boolean;
    universe: string;
    totalStocks: number;
    advancing: number;
    declining: number;
    unchanged: number;
    direction: string;
    breadthPercent: number;
    gainers: { symbol: string }[];
    losers: { symbol: string }[];
  };

  const data = (await createMarketMoversTool(loaderFor(MARKET)).execute({ limit: 3 })).data;

  assert.equal(json.success, true);
  assert.deepEqual(json.gainers.map((entry) => entry.symbol), data?.gainers.map((entry) => entry.symbol));
  assert.deepEqual(json.losers.map((entry) => entry.symbol), data?.losers.map((entry) => entry.symbol));
  assert.equal(json.totalStocks, data?.totalStocks);
  assert.equal(json.advancing, data?.advancing);
  assert.equal(json.declining, data?.declining);
  assert.equal(json.unchanged, data?.unchanged);
  assert.equal(json.direction, data?.direction);
  assert.equal(json.breadthPercent, data?.breadthPercent);
});
