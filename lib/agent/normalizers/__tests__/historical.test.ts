import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeHistorical } from "../historical";

test("normalizeHistorical returns [] when values is missing or not an array", () => {
  assert.deepEqual(normalizeHistorical(null), []);
  assert.deepEqual(normalizeHistorical({}), []);
  assert.deepEqual(normalizeHistorical({ values: "nope" }), []);
});

test("normalizeHistorical converts string OHLC fields to numbers", () => {
  const raw = {
    values: [
      { datetime: "2024-01-02", open: "10.5", high: "11", low: "9.5", close: "10.9", volume: "1000" },
    ],
  };

  const [point] = normalizeHistorical(raw);

  assert.equal(point.open, 10.5);
  assert.equal(point.high, 11);
  assert.equal(point.low, 9.5);
  assert.equal(point.close, 10.9);
  assert.equal(point.volume, 1000);
});

test("normalizeHistorical drops rows missing an OHLC field rather than filling 0", () => {
  const raw = {
    values: [
      { datetime: "2024-01-01", open: "10", high: "11", low: "9", close: "10.5" },
      { datetime: "2024-01-02", open: "10", high: "11", low: "9" }, // missing close
    ],
  };

  const result = normalizeHistorical(raw);

  assert.equal(result.length, 1);
  assert.equal(result[0].date, "2024-01-01");
});

test("normalizeHistorical treats missing volume as null, not 0", () => {
  const raw = {
    values: [{ datetime: "2024-01-01", open: "10", high: "11", low: "9", close: "10.5" }],
  };

  const [point] = normalizeHistorical(raw);

  assert.equal(point.volume, null);
});

test("normalizeHistorical sorts ascending by date (TwelveData returns newest-first)", () => {
  const raw = {
    values: [
      { datetime: "2024-01-03", open: "1", high: "1", low: "1", close: "1" },
      { datetime: "2024-01-01", open: "1", high: "1", low: "1", close: "1" },
      { datetime: "2024-01-02", open: "1", high: "1", low: "1", close: "1" },
    ],
  };

  const result = normalizeHistorical(raw);

  assert.deepEqual(result.map((p) => p.date), ["2024-01-01", "2024-01-02", "2024-01-03"]);
});

test("normalizeHistorical de-duplicates by date", () => {
  const raw = {
    values: [
      { datetime: "2024-01-01", open: "1", high: "1", low: "1", close: "1" },
      { datetime: "2024-01-01", open: "2", high: "2", low: "2", close: "2" },
    ],
  };

  assert.equal(normalizeHistorical(raw).length, 1);
});
