import { test } from "node:test";
import assert from "node:assert/strict";

import { checkOrder } from "../ledger";
import { exchangeLabel, maxQuantity, quoteStatus, reviewTicket } from "../ticket";

const base = { side: "buy" as const, assetType: "stock" as const, price: 100, currency: "INR" as const, cash: 10_000, held: 0 };

test("order value is price × quantity", () => {
  const review = reviewTicket({ ...base, quantityText: "7" });
  assert.deepEqual(review, { quantity: 7, value: 700, problem: null });
});

test("invalid quantities are refused with the server's wording", () => {
  assert.equal(reviewTicket({ ...base, quantityText: "" }).problem, "Enter a quantity.");
  assert.equal(reviewTicket({ ...base, quantityText: "0" }).problem, "Enter a quantity above zero.");
  assert.equal(reviewTicket({ ...base, quantityText: "-3" }).problem, "Enter a quantity above zero.");
  assert.equal(reviewTicket({ ...base, quantityText: "abc" }).problem, "Enter a quantity above zero.");
  assert.equal(reviewTicket({ ...base, quantityText: "1.5" }).problem, "Shares trade in whole numbers.");
  assert.equal(reviewTicket({ ...base, assetType: "crypto", quantityText: "0.123456789" }).problem, "Use at most 8 decimal places.");
  assert.equal(reviewTicket({ ...base, assetType: "crypto", quantityText: "0.5" }).problem, null);
});

test("the ticket and the server agree on what a valid quantity is", () => {
  const requestId = "0b4e7a52-3a1f-4c2e-9d7b-6f1e2a3b4c5d";
  for (const text of ["1", "0", "-1", "2.5", "abc"]) {
    const server = checkOrder({ requestId, assetType: "stock", symbol: "TCS", side: "buy", quantity: Number(text) });
    const ticket = reviewTicket({ ...base, quantityText: text });
    assert.equal(server.ok, ticket.problem === null, text);
  }
});

test("a buy above the available cash is refused", () => {
  assert.equal(reviewTicket({ ...base, cash: 650, quantityText: "7" }).problem, "Not enough virtual cash for this order.");
  assert.equal(reviewTicket({ ...base, cash: 700, quantityText: "7" }).problem, null);
});

test("a buy above the per-order cap is refused", () => {
  const review = reviewTicket({ ...base, price: 2_000, cash: 5_000_000, quantityText: "501" });
  assert.equal(review.problem, "One order can be worth at most ₹10,00,000.");
});

test("a sell can't exceed the holding, and sells don't need cash", () => {
  assert.equal(reviewTicket({ ...base, side: "sell", held: 0, quantityText: "1" }).problem, "You don't hold any to sell.");
  assert.equal(reviewTicket({ ...base, side: "sell", held: 4, quantityText: "5" }).problem, "You hold 4. You can't sell more than that.");
  assert.equal(reviewTicket({ ...base, side: "sell", held: 4, cash: 0, quantityText: "4" }).problem, null);
});

test("without a price the order isn't estimated or blocked; the server prices it", () => {
  assert.deepEqual(reviewTicket({ ...base, price: null, quantityText: "3" }), { quantity: 3, value: null, problem: null });
});

test("max quantity respects cash, the per-order cap and whole shares", () => {
  assert.equal(maxQuantity({ ...base, cash: 1_050 }), 10);
  assert.equal(maxQuantity({ ...base, price: 3_000, cash: 5_000_000 }), 333);
  assert.equal(maxQuantity({ ...base, assetType: "crypto", price: 3, cash: 10 }), 3.33333333);
  assert.equal(maxQuantity({ ...base, cash: 50 }), null);
  assert.equal(maxQuantity({ ...base, side: "sell", held: 12 }), 12);
  assert.equal(maxQuantity({ ...base, price: null }), null);
});

test("quote status: open, delayed, closed and unavailable", () => {
  const start = Date.UTC(2026, 9, 23, 3, 45);
  const end = Date.UTC(2026, 9, 23, 10, 0);
  const s = { assetType: "stock" as const, sessionStart: start, sessionEnd: end };
  const midday = start + 3 * 3_600_000;
  assert.equal(quoteStatus({ ...s, now: midday, lastTime: midday - 60_000 }), "open");
  assert.equal(quoteStatus({ ...s, now: midday, lastTime: midday - 20 * 60_000 }), "delayed");
  assert.equal(quoteStatus({ ...s, now: end + 3_600_000, lastTime: end - 60_000 }), "closed");
  assert.equal(quoteStatus({ ...s, now: midday, lastTime: null }), "unavailable");
  assert.equal(quoteStatus({ assetType: "crypto", sessionStart: null, sessionEnd: null, now: midday, lastTime: midday - 30_000 }), "open");
  assert.equal(quoteStatus({ assetType: "crypto", sessionStart: null, sessionEnd: null, now: midday, lastTime: midday - 3_600_000 }), "delayed");
});

test("exchange labels", () => {
  assert.equal(exchangeLabel("stock", "TCS"), "NSE");
  assert.equal(exchangeLabel("stock", "RPOWER.NS"), "NSE");
  assert.equal(exchangeLabel("stock", "500325.BO"), "BSE");
  assert.equal(exchangeLabel("stock", "AAPL"), "US");
  assert.equal(exchangeLabel("crypto", "BTC"), "Crypto");
});
