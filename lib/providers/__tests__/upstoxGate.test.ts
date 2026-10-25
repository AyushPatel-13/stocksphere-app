import assert from "node:assert/strict";
import test from "node:test";

import { UPSTOX_COOLDOWN_MS, noteUpstoxStatus, resetUpstoxCooldown, upstoxCoolingDown, upstoxFetch } from "../../apis/upstoxGate";

test("a 429 from Upstox pauses every Upstox call for a minute; other statuses don't", () => {
  resetUpstoxCooldown();
  noteUpstoxStatus(500, 0);
  noteUpstoxStatus(401, 0);
  assert.equal(upstoxCoolingDown(1), false);
  noteUpstoxStatus(429, 1_000);
  assert.equal(upstoxCoolingDown(1_000 + UPSTOX_COOLDOWN_MS - 1), true);
  assert.equal(upstoxCoolingDown(1_000 + UPSTOX_COOLDOWN_MS), false);
  resetUpstoxCooldown();
});

test("upstoxFetch: after a 429, nothing is sent until the cooldown ends", async () => {
  resetUpstoxCooldown();
  const realFetch = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = (async () => {
    sent++;
    return new Response("{}", { status: 429 });
  }) as typeof fetch;
  try {
    assert.equal((await upstoxFetch("https://api.upstox.com/v3/market-quote/quotes")).status, 429);
    const local = await upstoxFetch("https://api.upstox.com/v3/market-quote/quotes");
    assert.equal(local.status, 429, "callers see a refusal, so they fall back as usual");
    assert.match(await local.text(), /STOCKSPHERE_COOLDOWN/);
    assert.equal(sent, 1, "the second call never left the server");
  } finally {
    globalThis.fetch = realFetch;
    resetUpstoxCooldown();
  }
});
