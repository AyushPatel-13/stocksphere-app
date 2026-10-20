import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createPrediction,
  isDuplicateRequestError,
  type NewPredictionRow,
  type PredictionStore,
  type PredictionView,
} from "../service";
import { dailyVolatilityPct, movementBandPct, SCORING_V2 } from "../v2";
import type { MarketSnapshot, PredictionMarketData } from "../v2/sources";
import { POST as resolveRoute } from "@/app/api/predictions/resolve/route";
import { POST as createRoute } from "@/app/api/predictions/route";

// Monday 19 Oct 2026, 13:30 IST — the NSE session is open.
const NOW = Date.parse("2026-10-19T08:00:00.000Z");
const NSE = { start: Date.parse("2026-10-19T03:45:00.000Z"), end: Date.parse("2026-10-19T10:00:00.000Z") };
const FRIDAY_BAR = Date.parse("2026-10-16T03:45:00.000Z");
const ID_A = "3f0c6a8e-1b2d-4c5e-8f9a-0b1c2d3e4f50";
const ID_B = "7d2b9c41-5e6f-4a1b-9c3d-2e4f6a8b0c12";

function view(row: NewPredictionRow, id = "p1"): PredictionView {
  return {
    id,
    assetType: row.asset_type,
    symbol: row.symbol,
    direction: row.direction,
    horizon: row.horizon,
    targetPrice: row.target_price,
    entryPrice: row.reference_price,
    referenceMode: row.reference_mode,
    currency: row.currency,
    bandPct: row.band_pct,
    createdAt: row.submitted_at,
    estimatedExpiryAt: row.estimated_expiry_at,
    status: "open",
    note: row.note,
    result: null,
    user: { username: "ayush", displayName: "Ayush", avatarUrl: null, stats: { resolved: 0, wins: 0, points: 0 } },
  };
}

/** An in-memory store that honours unique (user, request id) like the database. */
function store(overrides: Partial<PredictionStore> = {}) {
  const saved = new Map<string, PredictionView>();
  const inserted: NewPredictionRow[] = [];
  const s: PredictionStore = {
    verifyToken: async (token) => (token === "good" ? "u1" : null),
    hasProfile: async () => true,
    findByRequestId: async (userId, requestId) => saved.get(`${userId}|${requestId}`) ?? null,
    countCreatedSince: async () => 0,
    hasOpen: async () => false,
    insert: async (row) => {
      const key = `${row.user_id}|${row.client_request_id}`;
      if (saved.has(key)) return "duplicate";
      inserted.push(row);
      const v = view(row, `p${inserted.length}`);
      saved.set(key, v);
      return v;
    },
    list: async () => [],
    leaderboard: async () => [],
    ...overrides,
  };
  return { s, inserted, saved };
}

function market(overrides: Partial<MarketSnapshot> = {}, calls: string[] = []): PredictionMarketData {
  return {
    snapshot: async (assetType, symbol) => {
      calls.push(`${assetType}:${symbol}`);
      if (symbol === "<X>") return null;
      return {
        symbol: symbol.toUpperCase(),
        currency: "INR",
        session: NSE,
        live: [{ price: 100, quoteTime: NOW - 30_000, source: "upstox" }],
        lastClose: { price: 98, time: FRIDAY_BAR, source: "yahoo" },
        dailyCloses: [],
        ...overrides,
      };
    },
  };
}

const base = { token: "good", requestId: ID_A, assetType: "stock", symbol: "tcs", direction: "up", horizon: "1w" };

test("a live call records the server's reference, band, expiry and scoring version", async () => {
  const { s, inserted } = store();
  const result = await createPrediction({ ...base, target: "103", note: "Strong deal pipeline" }, s, market(), NOW);

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.replayed, false);
  const row = inserted[0];
  assert.equal(row.symbol, "TCS");
  assert.equal(row.client_request_id, ID_A);
  assert.equal(row.reference_price, 100);
  assert.equal(row.reference_source, "upstox");
  assert.equal(row.reference_mode, "live");
  assert.equal(row.reference_quote_time, new Date(NOW - 30_000).toISOString());
  assert.equal(row.band_pct, movementBandPct("1w", null)); // no history → default band
  assert.equal(row.volatility_pct, null);
  assert.equal(row.expiry_sessions, 5);
  assert.equal(row.expires_at, null);
  assert.equal(row.estimated_expiry_at, "2026-10-23T10:00:00.000Z");
  assert.equal(row.submitted_at, new Date(NOW).toISOString());
  assert.equal(row.scoring_version, SCORING_V2.version);
  assert.equal(row.target_price, 103);
  assert.equal(row.note, "Strong deal pipeline");
});

test("the band comes from the asset's own volatility when history is available", async () => {
  const closes = Array.from({ length: 61 }, (_, i) => 100 * (1 + (i % 2 === 0 ? 0 : 0.02)));
  const { s, inserted } = store();
  await createPrediction({ ...base, direction: "sideways" }, s, market({ dailyCloses: closes }), NOW);

  const sigma = dailyVolatilityPct(closes)!;
  assert.equal(inserted[0].band_pct, movementBandPct("1w", sigma));
  assert.equal(inserted[0].volatility_pct, Math.round(sigma * 10_000) / 10_000);
  assert.equal(inserted[0].direction, "sideways");
  assert.equal(inserted[0].target_price, null);
});

test("market closed: the call is measured from the last official close", async () => {
  const evening = Date.parse("2026-10-19T12:00:00.000Z");
  const { s, inserted } = store();
  const result = await createPrediction({ ...base, horizon: "1d" }, s, market(), evening);

  assert.equal(result.ok, true);
  assert.equal(inserted[0].reference_mode, "from_close");
  assert.equal(inserted[0].reference_price, 98);
  assert.equal(inserted[0].reference_quote_time, new Date(FRIDAY_BAR).toISOString());
  // Session 1 is the next one: Tuesday's close.
  assert.equal(inserted[0].estimated_expiry_at, "2026-10-20T10:00:00.000Z");
});

test("crypto gets an exact expiry and no session count", async () => {
  const { s, inserted } = store();
  await createPrediction(
    { ...base, assetType: "crypto", symbol: "BTC", horizon: "1d" },
    s,
    market({ session: null, live: [{ price: 5_000_000, quoteTime: NOW - 10_000, source: "yahoo" }] }),
    NOW
  );
  assert.equal(inserted[0].expiry_sessions, null);
  assert.equal(inserted[0].expires_at, new Date(NOW + 24 * 3_600_000).toISOString());
});

test("the same request id twice saves one prediction and replays it", async () => {
  const { s, inserted } = store();
  const first = await createPrediction(base, s, market(), NOW);
  const second = await createPrediction(base, s, market(), NOW + 5_000);

  assert.equal(inserted.length, 1);
  assert.equal(first.ok && second.ok && first.prediction.id === second.prediction.id, true);
  assert.equal(second.ok && second.replayed, true);

  // A different id is a different call (here blocked only by the open-call rule).
  const third = await createPrediction({ ...base, requestId: ID_B }, s, market(), NOW);
  assert.equal(third.ok, true);
  assert.equal(inserted.length, 2);
});

test("a replay is answered before the price or limits are checked", async () => {
  const { s } = store();
  await createPrediction(base, s, market(), NOW);

  // Later the daily limit is reached and the price is stale — the retry of
  // the saved call still gets its prediction back, without reading prices.
  const calls: string[] = [];
  const replayed = await createPrediction(
    base,
    { ...s, countCreatedSince: async () => 99, hasOpen: async () => true },
    market({ live: [] }, calls),
    NOW + 60_000
  );
  assert.equal(replayed.ok && replayed.replayed, true);
  assert.deepEqual(calls, []);
});

test("two identical submits racing: the loser returns the winner's prediction", async () => {
  const { s, saved } = store();
  let racingInsertDone = false;
  const racing: PredictionStore = {
    ...s,
    // The lookup misses (the other request hasn't committed yet) ...
    findByRequestId: async (userId, requestId) => (racingInsertDone ? saved.get(`${userId}|${requestId}`) ?? null : null),
    // ... and the insert hits the unique constraint.
    insert: async (row) => {
      await s.insert(row);
      racingInsertDone = true;
      return "duplicate";
    },
  };

  const result = await createPrediction(base, racing, market(), NOW);
  assert.equal(result.ok && result.replayed, true);
  assert.equal(result.ok && result.prediction.id, "p1");

  assert.equal(isDuplicateRequestError({ code: "23505", message: 'duplicate key value violates unique constraint "predictions_request_unique"' }), true);
  assert.equal(isDuplicateRequestError({ code: "23505", message: "predictions_pkey" }), false);
  assert.equal(isDuplicateRequestError(null), false);
});

test("a stale price during market hours refuses the call and saves nothing", async () => {
  const { s, inserted } = store();
  const result = await createPrediction(base, s, market({ live: [{ price: 100, quoteTime: NOW - 10 * 60_000, source: "upstox" }] }), NOW);
  assert.deepEqual(result.ok ? null : [result.status, result.code], [503, "PRICE_UNAVAILABLE"]);
  assert.equal(inserted.length, 0);
});

test("refusals: setup, sign-in, profile, request id, symbol, limits, open call, targets", async () => {
  const m = market();
  const status = async (input: Record<string, unknown>, s: PredictionStore | null = store().s, mk = m) => {
    const result = await createPrediction({ ...base, ...input } as typeof base, s, mk, NOW);
    return result.ok ? 0 : result.status;
  };

  assert.equal(await status({}, null), 503);
  assert.equal(await status({ token: null }), 401);
  assert.equal(await status({ token: "bad" }), 401);
  assert.equal(await status({}, store({ hasProfile: async () => false }).s), 403);
  assert.equal(await status({ requestId: undefined }), 400);
  assert.equal(await status({ symbol: "<x>" }), 400);
  assert.equal(await status({ symbol: "LIQUIDBEES" }), 422);
  assert.equal(await status({ assetType: "etf", symbol: "GILT5YBEES.NS" }), 422);
  assert.equal(await status({}, store({ countCreatedSince: async () => SCORING_V2.submission.maxNewPerDay }).s), 422);
  assert.equal(await status({}, store({ hasOpen: async () => true }).s), 409);
  assert.equal(await status({ direction: "sideways", target: "101" }), 422);
  // Band for 1W without history is 1%: a target inside it, or past 20%, is refused.
  assert.equal(await status({ target: "100.5" }), 422);
  assert.equal(await status({ target: "125" }), 422);
  assert.equal(await status({ direction: "down", target: "101" }), 422);
  assert.equal(await status({ direction: "down", target: "97" }), 0);
});

/* ------------------------------------------------------------ routes */

function post(body: unknown, token = "good") {
  return new Request("http://x/api/predictions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("POST /api/predictions status codes", async () => {
  const { s } = store();
  const now = () => NOW;
  const body = { requestId: ID_A, symbol: "TCS", direction: "up", horizon: "1w" };

  const created = await createRoute(post(body), undefined, s, market(), now);
  assert.equal(created.status, 201);
  const replay = await createRoute(post(body), undefined, s, market(), now);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);

  assert.equal((await createRoute(post("{not json"), undefined, s, market(), now)).status, 400);
  assert.equal((await createRoute(post({ ...body, requestId: "nope" }), undefined, s, market(), now)).status, 400);
  assert.equal((await createRoute(post({ ...body, requestId: ID_B }, "bad"), undefined, s, market(), now)).status, 401);
  assert.equal((await createRoute(post({ ...body, requestId: ID_B }), undefined, store({ hasOpen: async () => true }).s, market(), now)).status, 409);
  assert.equal((await createRoute(post({ ...body, requestId: ID_B, direction: "flat" }), undefined, s, market(), now)).status, 422);

  const stale = await createRoute(post({ ...body, requestId: ID_B }), undefined, store().s, market({ live: [] }), now);
  assert.equal(stale.status, 503);
  assert.equal((await stale.json()).code, "PRICE_UNAVAILABLE");

  const off = await createRoute(post(body), undefined, null, market(), now);
  assert.equal(off.status, 503);
  assert.equal((await off.json()).code, "NOT_CONFIGURED");
});

test("the resolver endpoint stays closed without the secret", async () => {
  assert.equal((await resolveRoute(new Request("http://x", { method: "POST" }), undefined, undefined)).status, 401);
  assert.equal((await resolveRoute(new Request("http://x", { method: "POST", headers: { Authorization: "Bearer nope" } }), undefined, "secret")).status, 401);

  const off = await resolveRoute(new Request("http://x", { method: "POST", headers: { Authorization: "Bearer secret" } }), undefined, "secret", null);
  assert.equal(off.status, 503);

  const ok = await resolveRoute(
    new Request("http://x", { method: "POST", headers: { Authorization: "Bearer secret" } }),
    undefined,
    "secret",
    { due: async () => [], record: async () => true },
    { daily: async () => null, intraday: async () => null }
  );
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { success: true, resolved: 0, waiting: 0, failed: 0 });
});
