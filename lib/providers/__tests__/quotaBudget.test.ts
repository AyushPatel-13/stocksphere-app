import assert from "node:assert/strict";
import test from "node:test";

import { clientAddress, createWindowLimiter } from "../../utils/rateLimit";

test("createWindowLimiter: allows `limit` hits per window, then refuses until the oldest ages out", () => {
  const limiter = createWindowLimiter({ limit: 3, windowMs: 1_000 });
  assert.equal(limiter.take("a", 0), true);
  assert.equal(limiter.take("a", 100), true);
  assert.equal(limiter.take("a", 200), true);
  assert.equal(limiter.take("a", 300), false, "fourth hit inside the window is refused");
  assert.equal(limiter.retryAfterMs("a", 300), 700);
  assert.equal(limiter.take("b", 300), true, "keys are independent");
  assert.equal(limiter.take("a", 1_000), true, "the first hit has aged out");
  assert.equal(limiter.retryAfterMs("b", 300), 0);
});

test("createWindowLimiter: a refused hit is not counted", () => {
  const limiter = createWindowLimiter({ limit: 1, windowMs: 1_000 });
  assert.equal(limiter.take("", 0), true);
  assert.equal(limiter.take("", 500), false);
  assert.equal(limiter.take("", 1_000), true, "only the accepted hit at 0 counted");
});

test("createWindowLimiter: memory stays bounded by maxKeys", () => {
  const limiter = createWindowLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 });
  limiter.take("a", 0);
  limiter.take("b", 0);
  limiter.take("c", 0);
  assert.equal(limiter.take("a", 1), true, "'a' was evicted, so it has room again");
});

test("clientAddress: first x-forwarded-for hop, then x-real-ip, else null", () => {
  assert.equal(clientAddress(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } })), "1.2.3.4");
  assert.equal(clientAddress(new Request("http://x", { headers: { "x-real-ip": "5.6.7.8" } })), "5.6.7.8");
  assert.equal(clientAddress(new Request("http://x")), null);
});

test("Twelve Data and Alpha Vantage clients never send a call over budget", async () => {
  const { getStockQuote: twelve, twelveDataBudget } = await import("../../apis/twelvedata");
  const { getStockQuote: alpha, alphaVantageBudget } = await import("../../apis/alphavantage");
  const realFetch = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = (async () => {
    sent++;
    return new Response("{}");
  }) as typeof fetch;
  try {
    while (twelveDataBudget.take());
    while (alphaVantageBudget.take());
    assert.deepEqual(await twelve("AAPL"), { status: "error", code: 429, message: "StockSphere's Twelve Data budget for this minute is used up." });
    assert.ok("Information" in ((await alpha("AAPL")) as object));
    assert.equal(sent, 0, "nothing reached the network");
  } finally {
    globalThis.fetch = realFetch;
  }
});
