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
