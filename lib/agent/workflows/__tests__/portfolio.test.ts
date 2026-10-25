import { test } from "node:test";
import assert from "node:assert/strict";

import { analysePortfolio } from "../portfolio";

const q = (price: number, currency = "INR", changePercent: number | null = 1) => ({ price, currency, changePercent, asOf: "2026-10-23T10:29:00Z" });

test("weights, P/L and concentration are calculated per currency", () => {
  const result = analysePortfolio(
    [
      { symbol: "TCS", quantity: 10, buyPrice: 2000 }, // 25,300 now
      { symbol: "INFY", quantity: 10, buyPrice: 1200 }, // 11,538
      { symbol: "AAPL", quantity: 2, buyPrice: 300 }, // USD
    ],
    { TCS: q(2530), INFY: q(1153.8), AAPL: q(347.72, "USD") }
  );

  const inr = result.byCurrency.find((c) => c.currency === "INR")!;
  assert.equal(inr.totalValue, 36838);
  assert.equal(inr.totalInvested, 32000);
  assert.equal(inr.totalPnl, 4838);
  assert.equal(inr.totalPnlPct, 15.12);
  assert.deepEqual(inr.largestHolding, { symbol: "TCS", weightPct: 68.68 });
  assert.equal(inr.holdings[0].symbol, "TCS");
  assert.equal(inr.top3WeightPct, 100);
  assert.equal(inr.effectiveHoldings, 1.8);

  // Dollars are kept apart, never converted or added to rupees.
  const usd = result.byCurrency.find((c) => c.currency === "USD")!;
  assert.equal(usd.totalValue, 695.44);
  assert.equal(usd.holdings.length, 1);
});

test("a holding with no price is listed as unpriced, never valued at zero", () => {
  const result = analysePortfolio([{ symbol: "TCS", quantity: 1, buyPrice: 100 }, { symbol: "XYZ", quantity: 5, buyPrice: 10 }], { TCS: q(110), XYZ: null });
  assert.deepEqual(result.unpriced, ["XYZ"]);
  assert.equal(result.byCurrency[0].totalValue, 110);
  assert.equal(result.byCurrency[0].holdings.length, 1);
  assert.equal(result.holdingCount, 2);
});

test("an empty portfolio gives empty figures", () => {
  assert.deepEqual(analysePortfolio([], {}), { byCurrency: [], unpriced: [], holdingCount: 0 });
});
