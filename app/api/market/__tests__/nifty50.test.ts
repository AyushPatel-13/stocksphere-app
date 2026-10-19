import { test } from "node:test";
import assert from "node:assert/strict";

import type { AssetQuote } from "@/lib/types/quote";
import { GET } from "../nifty50/route";

// The route keeps a module-level 30s cache, so these run in order against one
// instance: an outage first (never cached), then a success, then a cache hit.

function quote(symbol: string, changePercent: number): AssetQuote {
  return {
    symbol,
    price: 100,
    change: changePercent,
    changePercent,
    volume: 1_000,
    currency: "INR",
  };
}

test("an empty Upstox answer is a 503 { success, error } and is not cached", async () => {
  let calls = 0;
  const empty = async () => {
    calls++;
    return [];
  };

  const first = await GET(undefined, undefined, empty);
  assert.equal(first.status, 503);
  assert.deepEqual(Object.keys(await first.json()).sort(), ["error", "success"]);

  await GET(undefined, undefined, empty);
  assert.equal(calls, 2);
});

test("a thrown loader is a 500 with a safe message", async () => {
  const response = await GET(undefined, undefined, async () => {
    throw new Error("UPSTOX token https://api.upstox.com secret");
  });
  const raw = await response.text();

  assert.equal(response.status, 500);
  assert.doesNotMatch(raw, /upstox\.com|secret|token/i);
});

test("success returns every quote, and a second request within the TTL reuses it", async () => {
  let calls = 0;
  const load = async () => {
    calls++;
    return [quote("TCS", 1.5), quote("INFY", -0.5)];
  };

  const response = await GET(undefined, undefined, load);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.universe, "NIFTY_50");
  assert.deepEqual(
    body.quotes.map((q: { symbol: string }) => q.symbol),
    ["TCS", "INFY"]
  );
  assert.equal(body.quotes[0].volume, 1_000);

  await GET(undefined, undefined, load);
  assert.equal(calls, 1);
});
