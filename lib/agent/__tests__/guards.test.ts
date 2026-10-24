import { test } from "node:test";
import assert from "node:assert/strict";

import { findUnsourcedComparisons, marketCapRefs, verifyMarketCaps } from "../guards";

const RELIANCE = { value: 16103642434460, display: "₹16.10 L Cr" };
const TCS = { value: 9150000000000, display: "₹9.15 L Cr" };
const INFY = { value: 4670000000000, display: "₹4.67 L Cr" };

test("regression: a market cap 100× too small (₹16,103.6 Cr) is replaced by the source's display value", () => {
  const answer = "| Market Capitalisation | ₹16,103.6 Cr | As of 31 Mar 2026 | [3] |";
  const result = verifyMarketCaps(answer, [RELIANCE]);
  assert.equal(result.answer, "| Market Capitalisation | ₹16.10 L Cr | As of 31 Mar 2026 | [3] |");
  assert.equal(result.corrected, 1);
});

test("correct market caps in any unit are left alone", () => {
  for (const text of ["Market cap ₹16.10 L Cr", "market-cap of 16,10,364 crore", "Market cap: ₹16.1 trillion", "Market cap 16,103.6 bn"]) {
    const result = verifyMarketCaps(text, [RELIANCE]);
    assert.equal(result.answer, text, text);
    assert.equal(result.corrected + result.flagged, 0, text);
  }
});

test("with several companies a wrong figure is marked unverified rather than guessed", () => {
  const row = "| Market cap | ₹9.15 L Cr | ₹46.7 L Cr |";
  const result = verifyMarketCaps(row, [TCS, INFY]);
  assert.equal(result.answer, "| Market cap | ₹9.15 L Cr | ₹46.7 L Cr (unverified: doesn't match the source) |");
  assert.equal(result.flagged, 1);
});

test("amounts on lines that aren't about market cap aren't touched", () => {
  const text = "Revenue rose to ₹49,244 Cr in Q2.";
  assert.equal(verifyMarketCaps(text, [RELIANCE]).answer, text);
});

test("market caps are found at any depth of the evidence", () => {
  assert.deepEqual(marketCapRefs([{ data: { marketCap: 5, marketCapDisplay: "₹5" } }, { marketCap: "x" }]), [{ value: 5, display: "₹5" }]);
});

test("regression: index and average comparisons that weren't fetched are found", () => {
  const data = [JSON.stringify({ pe: 17.64, dividendYield: 4.43 })];
  const answer =
    "- Valuation (P/E 17.6) is moderate compared to the broader Nifty IT index, which is around 20‑22.\n- Dividend yield of 4.4 % is above the Nifty average (~3.5 %).";
  const found = findUnsourcedComparisons(answer, data);
  assert.equal(found.length, 2);
  assert.match(found[0], /Nifty IT index/);
  assert.match(found[1], /Nifty average/);
});

test("comparisons whose figures were fetched, and index names, aren't flagged", () => {
  const data = [JSON.stringify({ pe: 17.64, indexPe: 21.3 })];
  assert.deepEqual(findUnsourcedComparisons("TCS's P/E of 17.64 is below the Nifty IT index P/E of 21.3 [2].", data), []);
  assert.deepEqual(findUnsourcedComparisons("Its P/E is 17.64; the Nifty 50 fell 0.39% the same day.", data), []);
  assert.deepEqual(findUnsourcedComparisons("Sector data isn't available, so the P/E can't be compared with peers.", data), []);
});
