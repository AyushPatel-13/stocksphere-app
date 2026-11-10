import { test } from "node:test";
import assert from "node:assert/strict";

import { absPercent, signedPercent } from "../StockBits";

test("a change shown on its own carries its sign, not just a colour", () => {
  assert.equal(signedPercent(2.555), "+2.56%");
  assert.equal(signedPercent(-1.49), "−1.49%");
  // Rounds to zero either way: no sign, and never "−0.00%".
  assert.equal(signedPercent(0), "0.00%");
  assert.equal(signedPercent(-0.004), "0.00%");
  for (const missing of [null, NaN, Infinity]) assert.equal(signedPercent(missing), "—");
  // Beside a signed amount the magnitude alone is still right.
  assert.equal(absPercent(-1.49), "1.49%");
});
