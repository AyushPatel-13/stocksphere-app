import { test } from "node:test";
import assert from "node:assert/strict";

import { logoSourceSymbol, logoUrl } from "@/lib/logos";
import { GET } from "@/app/api/logo/route";

test("logo symbols: NSE gets .NS, US stays bare, crypto becomes <COIN>USD, indices and bonds have none", () => {
  assert.equal(logoSourceSymbol("TCS"), "TCS.NS");
  assert.equal(logoSourceSymbol("RELIANCE.NS"), "RELIANCE.NS");
  assert.equal(logoSourceSymbol("RPOWER", "India"), "RPOWER.NS");
  assert.equal(logoSourceSymbol("AAPL"), "AAPL");
  assert.equal(logoSourceSymbol("SPY", "US", "etf"), "SPY");
  assert.equal(logoSourceSymbol("NIFTYBEES", "India", "etf"), "NIFTYBEES.NS");
  assert.equal(logoSourceSymbol("BTC", "Global", "crypto"), "BTCUSD");
  assert.equal(logoSourceSymbol("NOTACOIN", "Global", "crypto"), null);
  assert.equal(logoSourceSymbol("NIFTY", "India", "index"), null);
  assert.equal(logoSourceSymbol("US10Y", "US", "bond"), null);
  assert.equal(logoUrl("TCS"), "/api/logo?s=TCS.NS");
});

test("/api/logo serves the image, 404s a missing logo, caches both, and rejects bad input", async () => {
  let calls = 0;
  const png = new Uint8Array([137, 80, 78, 71]).buffer;
  const fetcher = async (symbol: string) => {
    calls++;
    return symbol === "AAPL" ? { body: png, type: "image/png" } : null;
  };

  const hit = await GET(new Request("http://x/api/logo?s=AAPL"), undefined, fetcher, 0);
  assert.equal(hit.status, 200);
  assert.equal(hit.headers.get("content-type"), "image/png");

  await GET(new Request("http://x/api/logo?s=AAPL"), undefined, fetcher, 1000);
  assert.equal(calls, 1);

  const miss = await GET(new Request("http://x/api/logo?s=ZZZZ"), undefined, fetcher, 0);
  assert.equal(miss.status, 404);
  await GET(new Request("http://x/api/logo?s=ZZZZ"), undefined, fetcher, 1000);
  assert.equal(calls, 2);

  assert.equal((await GET(new Request("http://x/api/logo?s=../../etc"), undefined, fetcher)).status, 400);
  assert.equal((await GET(new Request("http://x/api/logo"), undefined, fetcher)).status, 400);
});
