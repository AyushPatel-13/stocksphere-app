import { test } from "node:test";
import assert from "node:assert/strict";

import { checkExpectations, claimText, numbersIn, scoreGrounding } from "../score";

const data = [JSON.stringify({ price: 2530, changePercent: 0.9213, pe: 17.64, marketCap: 9150000000000, returnPct: -17.68, high: 3350 })];

test("figures from the data count as grounded, allowing for rounding and display scales", () => {
  const s = scoreGrounding("TCS is ₹2,530 (+0.92%), P/E 17.6, market cap ₹9.15 L Cr, down 17.68% from 3,350.", data);
  assert.deepEqual(s, { checked: 6, grounded: 6, ungrounded: [] });
});

test("regression: a market cap in the wrong unit is ungrounded; the right one in any unit is grounded", () => {
  const reliance = [JSON.stringify({ marketCap: 16103642434460 })];
  assert.deepEqual(scoreGrounding("Market cap ₹16,103.6 Cr.", reliance).ungrounded, ["16,103.6 Cr"]);
  assert.deepEqual(scoreGrounding("Market cap ₹16.10 L Cr, or 16,103.6 bn.", reliance), { checked: 2, grounded: 2, ungrounded: [] });
  // Display strings in the evidence count at their own scale.
  assert.deepEqual(scoreGrounding("Market cap ₹16.1 lakh crore.", [JSON.stringify({ marketCapDisplay: "₹16.10 L Cr" })]).ungrounded, []);
});

test("a figure that isn't in the data is reported", () => {
  const s = scoreGrounding("TCS has a P/E of 25.3 and ROE 41%.", data);
  assert.deepEqual(s.ungrounded, ["25.3", "41"]);
});

test("list numbers, years, dates, times and citation markers aren't scored", () => {
  const s = scoreGrounding("1. In 2026 [1] on 2026-10-23 at 10:29 the price was 2,530 [[2]](https://x.test/9999).\n\n**Sources**\n1. 12345", data);
  assert.deepEqual(s, { checked: 1, grounded: 1, ungrounded: [] });
  assert.doesNotMatch(claimText("a\n**Sources**\n1. 777"), /777/);
});

test("numbersIn reads JSON and Indian digit grouping", () => {
  assert.deepEqual(numbersIn('{"a":1,"b":-2.5} ₹1,11,769'), [1, -2.5, 111769]);
});

test("expectations check tools and phrases", () => {
  assert.deepEqual(checkExpectations("Price ₹10. Not investment advice.", ["get_price"], { tools: ["get_price", "get_news"], mustMatch: ["not investment advice"], mustNotMatch: ["buy now"] }), ["didn't use get_news"]);
});
