import assert from "node:assert/strict";
import test from "node:test";

import { columnShares } from "../AgentMarkdown";

/**
 * The table width rules behind the 390px overflow fix.
 *
 * These are fractions of the table's width, so they can be checked without a
 * browser: the properties that matter are that they always sum to the whole
 * table, that no column is left too narrow to render, and that a column holding
 * more text gets more room.
 */

const sum = (shares: number[]) => shares.reduce((total, share) => total + share, 0);

test("shares always add up to the whole table width", () => {
  const rows = [
    ["Metric", "TCS.NS", "INFY.NS"],
    ["Current price (INR)", "₹2,050.6", "₹994.1"],
    ["P/E ratio", "14.82", "13.32"],
  ];

  assert.ok(Math.abs(sum(columnShares(rows, 3)) - 1) < 1e-9);
  assert.ok(Math.abs(sum(columnShares(rows, 1)) - 1) < 1e-9);
  assert.ok(Math.abs(sum(columnShares([[]], 4)) - 1) < 1e-9);
});

test("no column is given less than half an equal share", () => {
  // A ragged row: the reader splits on every "|", so a URL inside a cell leaves
  // a trailing column holding five characters. Left to content alone it took
  // 5% of the table and its own padding swallowed it.
  const rows = [
    ["Metric", "TCS.NS", "INFY.NS"],
    ["Long token", "https://stocksphere.example.in/instruments/NSE_EQ", "quote"],
  ];

  const shares = columnShares(rows, 4);

  for (const share of shares) {
    assert.ok(share >= 0.5 / 4 - 1e-9, `column got ${share} of the table`);
  }

  // The floor is a floor, not a cap on the useful columns: the wide one still
  // gets more than the narrow one.
  assert.ok(shares[1] > shares[3]);
});

test("a column with more text is given more of the width", () => {
  const rows = [
    ["Metric", "Value"],
    ["Market-cap, EPS, dividend yield, 52-week high/low, ROE", "14.82"],
  ];

  const [metrics, value] = columnShares(rows, 2);

  assert.ok(metrics > value);
  // ...but not all of it: an equal share is still half of the split.
  assert.ok(metrics >= 0.5 && metrics <= 0.5 + 0.5);
  assert.ok(value >= 0.25);
});

test("one runaway cell cannot starve the columns beside it", () => {
  const rows = [
    ["Metric", "TCS.NS", "INFY.NS"],
    ["Source", "x".repeat(400), "see above"],
  ];

  const shares = columnShares(rows, 3);

  // The capped column is the widest, and every other column keeps its floor.
  assert.equal(shares[1], Math.max(...shares));
  for (const share of shares) assert.ok(share >= 0.5 / 3 - 1e-9);
});

test("a single-column table takes the whole width", () => {
  assert.deepEqual(columnShares([["Only column"], ["a value"]], 1), [1]);
});
