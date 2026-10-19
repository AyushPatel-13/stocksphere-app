import { test } from "node:test";
import assert from "node:assert/strict";

import { summariseHoldings, toHoldingView } from "../holdings";
import type { LiveQuote } from "../useQuotes";

function quote(price: number, change: number | null, currency = "INR"): LiveQuote {
  return { price, change, changePercent: null, volume: null, currency };
}

test("a priced holding gets current value, P/L, P/L % and 1D change", () => {
  const view = toHoldingView(
    { id: "1", symbol: "tcs", quantity: "10", buy_price: "100" },
    quote(110, 2)
  );

  assert.equal(view.symbol, "TCS");
  assert.equal(view.invested, 1000);
  assert.equal(view.current, 1100);
  assert.equal(view.pnl, 100);
  assert.equal(view.pnlPercent, 10);
  assert.equal(view.dayChange, 20);
});

test("an unpriced holding keeps its invested amount and invents nothing else", () => {
  const view = toHoldingView(
    { id: "1", symbol: "XYZ", quantity: 5, buy_price: 20 },
    null
  );

  assert.equal(view.invested, 100);
  assert.equal(view.current, null);
  assert.equal(view.pnl, null);
  assert.equal(view.dayChange, null);
});

test("totals are per currency and never mix rupees with dollars", () => {
  const { totals, unpriced } = summariseHoldings([
    toHoldingView({ id: "1", symbol: "TCS", quantity: 10, buy_price: 100 }, quote(110, 2)),
    toHoldingView({ id: "2", symbol: "INFY", quantity: 5, buy_price: 200 }, quote(190, -1)),
    toHoldingView({ id: "3", symbol: "AAPL", quantity: 1, buy_price: 300 }, quote(330, 3, "USD")),
  ]);

  assert.equal(unpriced, 0);
  assert.equal(totals.length, 2);

  const inr = totals.find((total) => total.currency === "INR")!;
  assert.equal(inr.invested, 2000);
  assert.equal(inr.current, 2050);
  assert.equal(inr.pnl, 50);
  assert.equal(inr.pnlPercent, 2.5);
  assert.equal(inr.dayChange, 15);
  // Previous close value = 2050 - 15.
  assert.ok(Math.abs((inr.dayChangePercent ?? 0) - (15 / 2035) * 100) < 1e-9);

  const usd = totals.find((total) => total.currency === "USD")!;
  assert.equal(usd.current, 330);
});

test("unpriced holdings are counted, and a missing 1D change voids that currency's 1D total", () => {
  const { totals, unpriced } = summariseHoldings([
    toHoldingView({ id: "1", symbol: "TCS", quantity: 1, buy_price: 100 }, quote(110, null)),
    toHoldingView({ id: "2", symbol: "XYZ", quantity: 1, buy_price: 100 }, null),
  ]);

  assert.equal(unpriced, 1);
  assert.equal(totals[0].dayChange, null);
  assert.equal(totals[0].dayChangePercent, null);
});
