import { test } from "node:test";
import assert from "node:assert/strict";

import { checkOrder, computePositions, valuePosition, type PaperTrade } from "../ledger";
import { fillPrice, placeOrder, type FillRequest, type PaperStore } from "../service";
import type { MarketSnapshot, PredictionMarketData } from "../../predictions/v2/sources";
import { POST } from "@/app/api/paper/orders/route";

const trade = (side: "buy" | "sell", quantity: number, price: number, minute: number, symbol = "TCS"): PaperTrade => ({
  id: `${symbol}-${minute}`,
  assetType: "stock",
  symbol,
  side,
  quantity,
  price,
  currency: "INR",
  executedAt: new Date(Date.UTC(2026, 9, 19, 4, minute)).toISOString(),
});

test("average cost and realised P&L follow the average-cost method", () => {
  const [tcs] = computePositions([trade("buy", 10, 100, 0), trade("buy", 10, 120, 1), trade("sell", 5, 130, 2)]);
  assert.equal(tcs.quantity, 15);
  assert.equal(tcs.averageCost, 110);
  assert.equal(tcs.invested, 1650);
  assert.equal(tcs.realizedPnl, 100); // (130 − 110) × 5
});

test("trades are applied in execution order and a closed position keeps its realised P&L", () => {
  // Given newest first, as the ledger is read.
  const [p] = computePositions([trade("sell", 10, 90, 5), trade("buy", 10, 100, 1)]);
  assert.equal(p.quantity, 0);
  assert.equal(p.averageCost, 0);
  assert.equal(p.realizedPnl, -100);
});

test("valuing a position never invents a price", () => {
  const [p] = computePositions([trade("buy", 10, 100, 0)]);
  assert.deepEqual(valuePosition(p, 110), { marketValue: 1100, unrealizedPnl: 100, unrealizedPct: 10 });
  assert.deepEqual(valuePosition(p, null), { marketValue: null, unrealizedPnl: null, unrealizedPct: null });
  assert.deepEqual(valuePosition(p, 0), { marketValue: null, unrealizedPnl: null, unrealizedPct: null });
});

const ID = "3f0c6a8e-1b2d-4c5e-8f9a-0b1c2d3e4f50";

test("order validation", () => {
  const ok = checkOrder({ requestId: ID, symbol: "tcs", side: "buy", quantity: "3" });
  assert.deepEqual(ok.ok && ok.value, { requestId: ID, assetType: "stock", symbol: "TCS", side: "buy", quantity: 3 });
  const reason = (raw: Record<string, unknown>) => {
    const r = checkOrder({ requestId: ID, symbol: "TCS", side: "buy", quantity: 1, ...raw });
    return r.ok ? null : r.reason;
  };
  assert.match(reason({ requestId: "x" })!, /request id/);
  assert.match(reason({ quantity: 1.5 })!, /whole/);
  assert.equal(reason({ assetType: "crypto", symbol: "BTC", quantity: 0.0025 }), null);
  assert.match(reason({ assetType: "crypto", symbol: "BTC", quantity: 0.000000001 })!, /8 decimal/);
  assert.match(reason({ quantity: 0 })!, /above zero/);
  assert.match(reason({ side: "short" })!, /buy or sell/);
  assert.match(reason({ assetType: "index" })!, /stocks, ETFs and crypto/);
});

// Monday 13:30 IST, NSE open.
const NOW = Date.parse("2026-10-19T08:00:00.000Z");
const NSE = { start: Date.parse("2026-10-19T03:45:00.000Z"), end: Date.parse("2026-10-19T10:00:00.000Z") };

function market(overrides: Partial<MarketSnapshot> = {}): PredictionMarketData {
  return {
    snapshot: async (_type, symbol) =>
      symbol === "<X>"
        ? null
        : {
            symbol: symbol.toUpperCase(),
            currency: "INR",
            session: NSE,
            live: [{ price: 100, quoteTime: NOW - 20_000, source: "upstox" }],
            lastClose: { price: 98, time: NOW - 86_400_000, source: "yahoo" },
            dailyCloses: [],
            ...overrides,
          },
  };
}

function store(outcome: "filled" | "replayed" | "insufficient_cash" | "insufficient_holding" = "filled") {
  const fills: FillRequest[] = [];
  const s: PaperStore = {
    verifyToken: async (token) => (token === "good" ? "u1" : null),
    fill: async (request) => {
      fills.push(request);
      return { tradeId: outcome === "filled" || outcome === "replayed" ? "t1" : null, outcome, cashAfter: 999_900 };
    },
  };
  return { s, fills };
}

const order = { token: "good", requestId: ID, symbol: "TCS", side: "buy", quantity: 1 };

test("an order fills at the server's live price, never a client price", async () => {
  const { s, fills } = store();
  const result = await placeOrder({ ...order, price: 1 } as never, s, market(), NOW);
  assert.equal(result.ok && result.status, 201);
  assert.equal(fills[0].price, 100);
  assert.equal(fills[0].priceSource, "upstox");
  assert.equal(fills[0].currency, "INR");
  assert.equal(fills[0].userId, "u1");
});

test("order refusals", async () => {
  const status = async (input: Record<string, unknown>, st = store().s, mk = market(), now = NOW) => {
    const r = await placeOrder({ ...order, ...input } as never, st, mk, now);
    return r.ok ? r.status : `${r.status} ${r.code}`;
  };
  assert.equal(await status({}, null as never), "503 NOT_CONFIGURED");
  assert.equal(await status({ token: null }), "401 SIGNED_OUT");
  assert.equal(await status({ token: "bad" }), "401 SIGNED_OUT");
  assert.equal(await status({ quantity: -1 }), "400 BAD_REQUEST");
  assert.equal(await status({ symbol: "<x>" }), "400 BAD_REQUEST");
  assert.equal(await status({}, store().s, market({ live: [] })), "503 PRICE_UNAVAILABLE");
  assert.equal(await status({}, store().s, market(), Date.parse("2026-10-19T12:00:00.000Z")), "409 MARKET_CLOSED");
  assert.equal(await status({ quantity: 20_000 }), "422 RULES");
  assert.equal(await status({}, store().s, market({ currency: "EUR" })), "422 RULES");
  assert.equal(await status({}, store("insufficient_cash").s), "422 INSUFFICIENT_CASH");
  assert.equal(await status({ side: "sell" }, store("insufficient_holding").s), "422 INSUFFICIENT_HOLDING");
  assert.equal(await status({}, store("replayed").s), 200);
});

test("crypto fills around the clock", async () => {
  const { s } = store();
  const sunday = Date.parse("2026-10-18T08:00:00.000Z");
  const result = await placeOrder(
    { ...order, assetType: "crypto", symbol: "BTC", quantity: 0.01 },
    s,
    market({ session: null, live: [{ price: 7_700_000, quoteTime: sunday - 10_000, source: "yahoo" }] }),
    sunday
  );
  assert.equal(result.ok, true);
});

test("a converted fill price is stored rounded", async () => {
  const { s, fills } = store();
  const sunday = Date.parse("2026-10-18T08:00:00.000Z");
  const result = await placeOrder(
    { ...order, assetType: "crypto", symbol: "BTC", quantity: 0.01 },
    s,
    market({ session: null, live: [{ price: 7_600_305.873199999, quoteTime: sunday - 10_000, source: "yahoo" }] }),
    sunday
  );
  assert.equal(fills[0].price, 7_600_305.87);
  assert.equal(result.ok && result.price, 7_600_305.87);
  assert.equal(fillPrice(0.123456789), 0.123457);
  assert.equal(fillPrice(100), 100);
});

test("POST /api/paper/orders takes the token from the header, not the body", async () => {
  const { s, fills } = store();
  const body = JSON.stringify({ ...order, token: "good" });
  const noHeader = await POST(new Request("http://x", { method: "POST", body }), undefined, s, market(), () => NOW);
  assert.equal(noHeader.status, 401);
  assert.equal(fills.length, 0);

  const ok = await POST(new Request("http://x", { method: "POST", headers: { Authorization: "Bearer good" }, body }), undefined, s, market(), () => NOW);
  assert.equal(ok.status, 201);
  assert.equal((await ok.json()).price, 100);
  assert.equal((await POST(new Request("http://x", { method: "POST", body: "{bad" }), undefined, s, market(), () => NOW)).status, 400);
});
