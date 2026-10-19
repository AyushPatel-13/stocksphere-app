import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createPrediction,
  firstCloseAtOrAfter,
  resolveDue,
  type DuePrediction,
  type NewPredictionRow,
  type PredictionStore,
  type PredictionView,
  type PriceSource,
} from "../service";
import { POST as resolveRoute } from "@/app/api/predictions/resolve/route";
import { POST as createRoute } from "@/app/api/predictions/route";

const NOW = Date.parse("2026-10-19T08:00:00.000Z");

function view(row: NewPredictionRow): PredictionView {
  return {
    id: "p1",
    assetType: row.asset_type,
    symbol: row.symbol,
    direction: row.direction,
    horizon: row.horizon,
    targetPrice: row.target_price,
    entryPrice: row.entry_price,
    currency: row.currency,
    createdAt: new Date(NOW).toISOString(),
    resolvesAt: row.resolves_at,
    status: "open",
    exitPrice: null,
    resolvedAt: null,
    points: 0,
    note: row.note,
    user: { username: "ayush", displayName: "Ayush", avatarUrl: null, stats: { resolved: 0, wins: 0, points: 0 } },
  };
}

function store(overrides: Partial<PredictionStore> = {}) {
  const inserted: NewPredictionRow[] = [];
  const resolved: { id: string; status: string; points: number; exit_price: number }[] = [];
  const recomputed: string[] = [];
  const s: PredictionStore = {
    verifyToken: async (token) => (token === "good" ? "u1" : null),
    hasProfile: async () => true,
    countCreatedSince: async () => 0,
    hasOpen: async () => false,
    insert: async (row) => {
      inserted.push(row);
      return view(row);
    },
    list: async () => [],
    due: async () => [],
    resolve: async (id, result) => {
      resolved.push({ id, ...result });
      return true;
    },
    recomputeStats: async (userId) => {
      recomputed.push(userId);
    },
    leaderboard: async () => [],
    ...overrides,
  };
  return { s, inserted, resolved, recomputed };
}

const prices = (latest: number | null, close: number | null = null): PriceSource => ({
  latest: async () => (latest === null ? null : { price: latest, currency: "INR" }),
  closeAtOrAfter: async () => close,
});

test("a prediction records the server's live price as entry, never the client's", async () => {
  const { s, inserted } = store();
  const result = await createPrediction(
    { token: "good", assetType: "stock", symbol: "tcs", direction: "up", horizon: "1w", target: "2600", note: "Strong deal pipeline" },
    s,
    prices(2456.1),
    NOW
  );

  assert.equal(result.ok, true);
  assert.equal(inserted[0].entry_price, 2456.1);
  assert.equal(inserted[0].symbol, "TCS");
  assert.equal(inserted[0].currency, "INR");
  assert.equal(inserted[0].resolves_at, "2026-10-26T08:00:00.000Z");
  assert.equal(inserted[0].target_price, 2600);
});

test("refusals: signed out, no profile, unknown symbol, rules, no live price, target on the wrong side", async () => {
  const p = prices(100);
  const base = { token: "good", assetType: "stock", symbol: "TCS", direction: "up", horizon: "1d" };

  assert.equal((await createPrediction({ ...base, token: null }, store().s, p, NOW) as { status: number }).status, 401);
  assert.equal((await createPrediction(base, store({ hasProfile: async () => false }).s, p, NOW) as { code?: string }).code, "NO_PROFILE");
  assert.equal((await createPrediction({ ...base, symbol: "<x>" }, store().s, p, NOW) as { status: number }).status, 400);
  assert.equal((await createPrediction({ ...base, direction: "flat" }, store().s, p, NOW) as { status: number }).status, 422);
  assert.equal((await createPrediction(base, store({ hasOpen: async () => true }).s, p, NOW) as { status: number }).status, 422);
  assert.equal((await createPrediction(base, store().s, prices(null), NOW) as { status: number }).status, 503);
  assert.equal((await createPrediction({ ...base, target: "90" }, store().s, p, NOW) as { status: number }).status, 422);
  assert.equal((await createPrediction({ ...base, note: "join my telegram channel for calls" }, store().s, p, NOW) as { status: number }).status, 422);
});

test("due predictions are scored from the real close, then the member's stats are recomputed", async () => {
  const due: DuePrediction[] = [
    { id: "a", userId: "u1", assetType: "stock", symbol: "TCS", direction: "up", horizon: "1d", entryPrice: 100, targetPrice: null, resolvesAt: "2026-10-18T08:00:00Z" },
    { id: "b", userId: "u2", assetType: "stock", symbol: "INFY", direction: "down", horizon: "1d", entryPrice: 100, targetPrice: null, resolvesAt: "2026-10-18T08:00:00Z" },
  ];
  const { s, resolved, recomputed } = store({ due: async () => due });

  const result = await resolveDue(s, prices(0, 105), NOW);

  assert.deepEqual(result, { resolved: 2, pending: 0 });
  assert.deepEqual(resolved.map((r) => [r.id, r.status, r.points]), [["a", "won", 10], ["b", "lost", 0]]);
  assert.deepEqual(recomputed.sort(), ["u1", "u2"]);
});

test("a prediction stays open until the market prints a price after its deadline", async () => {
  const due: DuePrediction[] = [
    { id: "a", userId: "u1", assetType: "stock", symbol: "TCS", direction: "up", horizon: "1d", entryPrice: 100, targetPrice: null, resolvesAt: "2026-10-18T08:00:00Z" },
  ];
  const { s, resolved } = store({ due: async () => due });

  assert.deepEqual(await resolveDue(s, prices(0, null), NOW), { resolved: 0, pending: 1 });
  assert.equal(resolved.length, 0);

  assert.equal(firstCloseAtOrAfter([{ t: 1, o: 1, h: 1, l: 1, c: 10, v: 0 }, { t: 5, o: 1, h: 1, l: 1, c: 12, v: 0 }], 3), 12);
  assert.equal(firstCloseAtOrAfter([{ t: 1, o: 1, h: 1, l: 1, c: 10, v: 0 }], 3), null);
});

test("an already-closed prediction isn't counted twice", async () => {
  const due: DuePrediction[] = [
    { id: "a", userId: "u1", assetType: "stock", symbol: "TCS", direction: "up", horizon: "1d", entryPrice: 100, targetPrice: null, resolvesAt: "2026-10-18T08:00:00Z" },
  ];
  const { s, recomputed } = store({ due: async () => due, resolve: async () => false });

  assert.deepEqual(await resolveDue(s, prices(0, 110), NOW), { resolved: 0, pending: 1 });
  assert.deepEqual(recomputed, []);
});

test("the resolver endpoint is closed without the right secret", async () => {
  const { s } = store();
  const p = prices(1);

  assert.equal((await resolveRoute(new Request("http://x", { method: "POST" }), undefined, s, p, undefined)).status, 401);
  assert.equal((await resolveRoute(new Request("http://x", { method: "POST", headers: { Authorization: "Bearer nope" } }), undefined, s, p, "secret")).status, 401);
  assert.equal((await resolveRoute(new Request("http://x", { method: "POST", headers: { Authorization: "Bearer secret" } }), undefined, s, p, "secret")).status, 200);

  const created = await createRoute(
    new Request("http://x/api/predictions", {
      method: "POST",
      headers: { Authorization: "Bearer good" },
      body: JSON.stringify({ symbol: "AAPL", direction: "down", horizon: "1m" }),
    }),
    undefined,
    s,
    p
  );
  assert.equal(created.status, 201);
});
