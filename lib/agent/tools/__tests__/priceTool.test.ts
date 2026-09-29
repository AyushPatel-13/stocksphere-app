import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidPrice } from "../priceTool";

test("isValidPrice accepts a well-formed quote", () => {
  assert.equal(
    isValidPrice({
      symbol: "AAPL",
      price: 150.2,
      change: 1,
      changePercent: 0.5,
      open: 149,
      high: 151,
      low: 148,
      previousClose: 149.2,
      volume: 1000,
      currency: "USD",
    }),
    true
  );
});

test("isValidPrice accepts a quote with only symbol and price (AssetQuote's other fields are optional)", () => {
  assert.equal(isValidPrice({ symbol: "TCS.NS", price: 3120.5 }), true);
});

test("isValidPrice rejects null/undefined", () => {
  assert.equal(isValidPrice(null), false);
  assert.equal(isValidPrice(undefined), false);
});

test("isValidPrice rejects a NaN price rather than treating it as valid", () => {
  assert.equal(
    isValidPrice({
      symbol: "AAPL",
      price: NaN,
      change: 0,
      changePercent: 0,
      open: 0,
      high: 0,
      low: 0,
      previousClose: 0,
      volume: 0,
      currency: "USD",
    }),
    false
  );
});
