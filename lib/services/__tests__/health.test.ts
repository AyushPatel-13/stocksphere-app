import assert from "node:assert/strict";
import test from "node:test";

import { clearHealthCache, getHealth, upstoxHealthOf } from "../health";

test("upstoxHealthOf: a rejected token is 'expired', a missing one 'not_configured', anything else 'unreachable'", () => {
  assert.equal(upstoxHealthOf({ ok: true, body: {} }), "ok");
  assert.equal(upstoxHealthOf({ ok: false, code: "auth", status: 401 }), "expired");
  assert.equal(upstoxHealthOf({ ok: false, code: "not_configured", status: null }), "not_configured");
  assert.equal(upstoxHealthOf({ ok: false, code: "timeout", status: null }), "unreachable");
  assert.equal(upstoxHealthOf({ ok: false, code: "provider", status: 500 }), "unreachable");
});

test("getHealth: checks Upstox at most once per five minutes", async () => {
  clearHealthCache();
  let calls = 0;
  const check = async () => {
    calls++;
    return { ok: false as const, code: "auth" as const, status: 401 };
  };
  const first = await getHealth(check, 0);
  assert.equal(first.upstox.status, "expired");
  assert.match(first.upstox.message, /expired/);
  await getHealth(check, 4 * 60_000);
  assert.equal(calls, 1);
  await getHealth(check, 6 * 60_000);
  assert.equal(calls, 2);
  clearHealthCache();
});
