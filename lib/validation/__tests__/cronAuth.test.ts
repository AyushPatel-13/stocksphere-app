import assert from "node:assert/strict";
import test from "node:test";

import { isCronAuthorized } from "../../utils/cronAuth";

test("isCronAuthorized: only the exact bearer secret passes, and nothing passes without a secret", () => {
  assert.equal(isCronAuthorized("Bearer s3cret", "s3cret"), true);
  assert.equal(isCronAuthorized("Bearer s3cret ", "s3cret"), false);
  assert.equal(isCronAuthorized("bearer s3cret", "s3cret"), false);
  assert.equal(isCronAuthorized("Bearer wrong", "s3cret"), false);
  assert.equal(isCronAuthorized(null, "s3cret"), false);
  assert.equal(isCronAuthorized("Bearer ", ""), false);
  assert.equal(isCronAuthorized("Bearer undefined", undefined), false);
});
