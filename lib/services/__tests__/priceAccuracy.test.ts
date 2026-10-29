import { test } from "node:test";
import assert from "node:assert/strict";

import { getPrice } from "../price";
import { roundPercent, roundPrice, roundQuote } from "../../utils/roundPrice";
import type { AssetQuote } from "../../types/quote";

test("prices round to 2 decimals, sub-1 prices keep 6 significant figures", () => {
  assert.equal(roundPrice(54275.3984375), 54275.4);
  assert.equal(roundPrice(528.1399841308594), 528.14);
  assert.equal(roundPrice(-99.29999999999563), -99.3);
  assert.equal(roundPrice(0.000123456789), 0.000123457);
  assert.equal(roundPrice(0), 0);
  assert.ok(Number.isNaN(roundPrice(NaN)));
  assert.equal(roundPercent(0.53987654), 0.54);
});

test("roundQuote rounds prices and percent, and leaves volume and labels alone", () => {
  const quote: AssetQuote = {
    symbol: "MSFT", price: 528.1399841308594, change: 2.1300048828125, changePercent: 0.40494,
    previousClose: 526.0099792480469, volume: 123456789, currency: "USD", source: "Yahoo",
  };
  assert.deepEqual(roundQuote(quote), {
    symbol: "MSFT", price: 528.14, change: 2.13, changePercent: 0.4,
    previousClose: 526.01, volume: 123456789, currency: "USD", source: "Yahoo",
  });
});

test("the stock header prices from getMarketQuote, with a currency even when the provider omits it", async () => {
  const asked: string[] = [];
  const lookup = async (symbol: string): Promise<AssetQuote | null> => {
    asked.push(symbol);
    return symbol === "NONE" ? null : { symbol, price: 528.14, change: 2.13, changePercent: 0.4, source: "Yahoo" };
  };

  const us = await getPrice("MSFT", lookup);
  assert.equal(us?.price, 528.14);
  assert.equal(us?.currency, "USD");
  // Fields the source didn't report are NaN (shown as N/A), never 0.
  assert.ok(Number.isNaN(us?.open));

  assert.equal((await getPrice("RELIANCE", lookup))?.currency, "INR");
  assert.equal(await getPrice("NONE", lookup), null);
  assert.deepEqual(asked, ["MSFT", "RELIANCE", "NONE"]);
});

import { roundChange, roundMarketPayload } from "../../utils/roundPrice";

test("a change is rounded at its price's precision: CAC 40's -0.180176 is -0.18", () => {
  assert.equal(roundChange(-0.180176, 7886.96), -0.18);
  assert.equal(roundChange(-0.180176), -0.18);
  // A sub-1 price moves in small steps, so its change keeps 6 significant figures.
  assert.equal(roundChange(0.0000123456789, 0.000987), 0.0000123457);
});

test("whole responses are rounded by field name, and nothing else is touched", () => {
  const body = {
    universe: "NIFTY_50",
    breadthPercent: 50.98039215686274,
    totalStocks: 51,
    items: [
      { symbol: "NIFTYBEES", unit: "currency", price: 259.59, change: 0.0999999999999659, changePercent: 0.038537130525247945, volume: 123456, marketTime: "2026-10-28T10:00:00.000Z" },
      { symbol: "US3M", unit: "percent", price: 3.9950001, change: -0.04499999999999993, changePercent: -1.1138613861386 },
      { symbol: "SHIB", unit: "currency", price: 0.0000123456789, change: -0.000000123456789, changePercent: null },
    ],
    gainers: [{ symbol: "APOLLOHOSP", price: 8137, change: 345.5, changePercent: 4.434319450683437, open: 7791.5 }],
  };
  assert.deepEqual(roundMarketPayload(body), {
    universe: "NIFTY_50",
    breadthPercent: 50.98,
    totalStocks: 51,
    items: [
      { symbol: "NIFTYBEES", unit: "currency", price: 259.59, change: 0.1, changePercent: 0.04, volume: 123456, marketTime: "2026-10-28T10:00:00.000Z" },
      { symbol: "US3M", unit: "percent", price: 3.995, change: -0.045, changePercent: -1.11 },
      { symbol: "SHIB", unit: "currency", price: 0.0000123457, change: -1.23457e-7, changePercent: null },
    ],
    gainers: [{ symbol: "APOLLOHOSP", price: 8137, change: 345.5, changePercent: 4.43, open: 7791.5 }],
  });
  // The input is left as it was.
  assert.equal(body.breadthPercent, 50.98039215686274);
});
