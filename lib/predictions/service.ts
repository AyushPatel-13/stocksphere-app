import { bareIndianSymbol } from "../data/instruments/india";
import { getAdminClient, getPublicClient } from "../supabase/server";
import { horizonOf, type PredictionAssetType, type PredictionStats } from "./rules";
import {
  SCORING_V2,
  dailyVolatilityPct,
  movementBandPct,
  validateTarget,
  type CallDirection,
  type Horizon,
  type ScoringConfig,
} from "./v2";
import {
  chooseReference,
  defaultCloseTimeOfDayMs,
  estimateExpiry,
  timeOfDayMs,
  type ReferenceMode,
  type ReferenceSource,
} from "./v2/reference";
import { isExcludedSymbol, parseSubmission } from "./v2/submission";
import type { PredictionMarketData } from "./v2/sources";

/**
 * Predictions: created and listed here, and only here.
 *
 * Fairness comes from what the client never controls: the reference price is
 * read by the server at submission (live while the market is open, the last
 * official close otherwise), the movement band is frozen at submission, and a
 * saved prediction can't be edited (the database locks it).
 *
 * Scoring happens in ./resolver.ts (Phase 2), run by the scheduled job.
 */

export type PredictionStatus = "open" | "correct" | "incorrect" | "flat" | "void" | "review";

export type PredictionView = {
  id: string;
  assetType: PredictionAssetType;
  symbol: string;
  direction: CallDirection;
  horizon: Horizon;
  targetPrice: number | null;
  /** The reference price the call is measured from. */
  entryPrice: number;
  referenceMode: ReferenceMode;
  currency: string | null;
  bandPct: number;
  createdAt: string;
  estimatedExpiryAt: string;
  status: PredictionStatus;
  note: string | null;
  /** The scored result, once the prediction has been resolved. */
  result: PredictionResult | null;
  user: { username: string; displayName: string; avatarUrl: string | null; stats: PredictionStats };
};

export type PredictionResult = {
  exitPrice: number | null;
  exitSession: string | null;
  movePct: number | null;
  points: number;
  reason: string | null;
};

export type LeaderRow = {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  stats: PredictionStats;
};

export type NewPredictionRow = {
  user_id: string;
  client_request_id: string;
  asset_type: PredictionAssetType;
  symbol: string;
  direction: CallDirection;
  horizon: Horizon;
  target_price: number | null;
  note: string | null;
  reference_price: number;
  reference_source: ReferenceSource;
  reference_mode: ReferenceMode;
  reference_quote_time: string;
  currency: string | null;
  band_pct: number;
  volatility_pct: number | null;
  expiry_sessions: 1 | 5 | 21 | null;
  expires_at: string | null;
  estimated_expiry_at: string;
  submitted_at: string;
  scoring_version: string;
};

export interface PredictionStore {
  verifyToken(token: string): Promise<string | null>;
  hasProfile(userId: string): Promise<boolean>;
  /** The prediction an earlier attempt with this request id created, if any. */
  findByRequestId(userId: string, requestId: string): Promise<PredictionView | null>;
  countCreatedSince(userId: string, sinceIso: string): Promise<number>;
  hasOpen(userId: string, assetType: string, symbol: string, horizon: string): Promise<boolean>;
  /** "duplicate" when (user, request id) already exists — a concurrent retry. */
  insert(row: NewPredictionRow): Promise<PredictionView | "duplicate">;
  list(query: { username?: string; symbol?: string; status?: "open" | "resolved"; limit: number }): Promise<PredictionView[]>;
  leaderboard(limit: number): Promise<LeaderRow[]>;
}

/* ------------------------------------------------------------ create */

export type CreateResult =
  | { ok: true; prediction: PredictionView; replayed: boolean }
  | { ok: false; status: number; error: string; code?: string };

const rules = (error: string): CreateResult => ({ ok: false, status: 422, error, code: "RULES" });

export async function createPrediction(
  input: {
    token: string | null;
    requestId: unknown;
    assetType: unknown;
    symbol: unknown;
    direction: unknown;
    horizon: unknown;
    target?: unknown;
    note?: unknown;
  },
  store: PredictionStore | null,
  market: PredictionMarketData,
  now: number = Date.now(),
  config: ScoringConfig = SCORING_V2
): Promise<CreateResult> {
  if (!store) return { ok: false, status: 503, error: "Predictions aren't set up yet.", code: "NOT_CONFIGURED" };
  if (!input.token) return { ok: false, status: 401, error: "Sign in to make predictions.", code: "SIGNED_OUT" };

  const userId = await store.verifyToken(input.token);
  if (!userId) return { ok: false, status: 401, error: "Your session expired. Please sign in again.", code: "SIGNED_OUT" };
  if (!(await store.hasProfile(userId))) {
    return { ok: false, status: 403, error: "Pick your @handle before predicting.", code: "NO_PROFILE" };
  }

  const parsed = parseSubmission(input, config);
  if (!parsed.ok) return { ok: false, status: parsed.status, error: parsed.reason, code: parsed.code };
  const call = parsed.value;

  // A retried submit returns what the first attempt saved — never a second call.
  const earlier = await store.findByRequestId(userId, call.requestId);
  if (earlier) return { ok: true, prediction: earlier, replayed: true };

  const [todayCount, openOnSameCall] = await Promise.all([
    store.countCreatedSince(userId, new Date(now - 86_400_000).toISOString()),
    store.hasOpen(userId, call.assetType, call.symbol, call.horizon),
  ]);
  if (todayCount >= config.submission.maxNewPerDay) {
    return rules(`You can make up to ${config.submission.maxNewPerDay} predictions a day.`);
  }
  if (openOnSameCall) {
    return { ok: false, status: 409, error: "You already have an open prediction on this for that time frame.", code: "DUPLICATE_OPEN" };
  }

  const snapshot = await market.snapshot(call.assetType, call.symbol, now);
  if (!snapshot) return { ok: false, status: 400, error: "We don't recognise that symbol." };
  if (isExcludedSymbol(bareIndianSymbol(snapshot.symbol), config)) {
    return rules("Liquid and bond ETFs barely move, so they can't be predicted.");
  }

  const reference = chooseReference(
    { assetType: call.assetType, now, session: snapshot.session, live: snapshot.live, lastClose: snapshot.lastClose },
    config
  );
  if ("error" in reference) {
    return {
      ok: false,
      status: 503,
      error:
        reference.error === "stale"
          ? "The live price is delayed right now, so we can't lock a fair entry. Try again in a minute."
          : "We couldn't get a price for this right now. Try again shortly.",
      code: "PRICE_UNAVAILABLE",
    };
  }

  const volatility = dailyVolatilityPct(snapshot.dailyCloses);
  const bandPct = movementBandPct(call.horizon, volatility, config);

  const targetCheck = validateTarget(call.direction, call.horizon, reference.price, call.target, bandPct, config);
  if (!targetCheck.ok) return rules(targetCheck.reason);

  const expiry = estimateExpiry(
    {
      now,
      horizon: call.horizon,
      assetType: call.assetType,
      closeTimeOfDayMs: snapshot.session ? timeOfDayMs(snapshot.session.end) : defaultCloseTimeOfDayMs(snapshot.currency),
    },
    config
  );

  const row: NewPredictionRow = {
    user_id: userId,
    client_request_id: call.requestId,
    asset_type: call.assetType,
    symbol: snapshot.symbol,
    direction: call.direction,
    horizon: call.horizon,
    target_price: call.target,
    note: call.note,
    reference_price: reference.price,
    reference_source: reference.source,
    reference_mode: reference.mode,
    reference_quote_time: new Date(reference.quoteTime).toISOString(),
    currency: snapshot.currency,
    band_pct: bandPct,
    volatility_pct: volatility === null ? null : Math.round(volatility * 10_000) / 10_000,
    expiry_sessions: expiry.expirySessions,
    expires_at: expiry.expiresAt === null ? null : new Date(expiry.expiresAt).toISOString(),
    estimated_expiry_at: new Date(expiry.estimatedExpiryAt).toISOString(),
    submitted_at: new Date(now).toISOString(),
    scoring_version: config.version,
  };

  const saved = await store.insert(row);
  if (saved !== "duplicate") return { ok: true, prediction: saved, replayed: false };

  // Two identical submits raced; the other one won. Return its prediction.
  const winner = await store.findByRequestId(userId, call.requestId);
  if (winner) return { ok: true, prediction: winner, replayed: true };
  throw new Error("Duplicate prediction request but no saved prediction found");
}

/* ------------------------------------------------------------ Supabase store */

const VIEW_COLUMNS =
  "id, asset_type, symbol, direction, horizon, target_price, reference_price, reference_mode, currency, band_pct, submitted_at, estimated_expiry_at, status, note, result:prediction_resolutions(exit_price, exit_session, move_pct, total_points, reason), user:profiles!predictions_user_id_fkey(username, display_name, avatar_url, pred_resolved, pred_wins, pred_points)";

type Row = {
  id: string;
  asset_type: PredictionAssetType;
  symbol: string;
  direction: CallDirection;
  horizon: Horizon;
  target_price: number | string | null;
  reference_price: number | string;
  reference_mode: ReferenceMode;
  currency: string | null;
  band_pct: number | string;
  submitted_at: string;
  estimated_expiry_at: string;
  status: PredictionStatus;
  note: string | null;
  result: ResultJoin | ResultJoin[] | null;
  user: ProfileJoin | ProfileJoin[] | null;
};

type ResultJoin = {
  exit_price: number | string | null;
  exit_session: string | null;
  move_pct: number | string | null;
  total_points: number;
  reason: string | null;
};

type ProfileJoin = {
  username: string;
  display_name: string;
  avatar_url: string | null;
  pred_resolved: number;
  pred_wins: number;
  pred_points: number;
};

const numOrNull = (value: number | string | null) => (value === null ? null : Number(value));

function statsOf(profile: ProfileJoin | null | undefined): PredictionStats {
  return {
    resolved: profile?.pred_resolved ?? 0,
    wins: profile?.pred_wins ?? 0,
    points: profile?.pred_points ?? 0,
  };
}

export function toView(row: Row): PredictionView {
  const user = Array.isArray(row.user) ? row.user[0] : row.user;
  const result = Array.isArray(row.result) ? row.result[0] : row.result;
  return {
    id: row.id,
    assetType: row.asset_type,
    symbol: row.symbol,
    direction: row.direction,
    horizon: row.horizon,
    targetPrice: numOrNull(row.target_price),
    entryPrice: Number(row.reference_price),
    referenceMode: row.reference_mode,
    currency: row.currency,
    bandPct: Number(row.band_pct),
    createdAt: row.submitted_at,
    estimatedExpiryAt: row.estimated_expiry_at,
    status: row.status,
    note: row.note,
    result: result
      ? {
          exitPrice: numOrNull(result.exit_price),
          exitSession: result.exit_session,
          movePct: numOrNull(result.move_pct),
          points: result.total_points,
          reason: result.reason,
        }
      : null,
    user: {
      username: user?.username ?? "deleted",
      displayName: user?.display_name ?? "Deleted user",
      avatarUrl: user?.avatar_url ?? null,
      stats: statsOf(user),
    },
  };
}

/** Postgres unique_violation on the per-user request id. */
export function isDuplicateRequestError(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && error.code === "23505" && (error.message ?? "").includes("predictions_request_unique"));
}

export function getPredictionStore(): PredictionStore | null {
  const admin = getAdminClient();
  const reader = getPublicClient();
  if (!admin || !reader) return null;

  return {
    async verifyToken(token) {
      const { data, error } = await admin.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },

    async hasProfile(userId) {
      const { data } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
      return Boolean(data);
    },

    async findByRequestId(userId, requestId) {
      const { data, error } = await admin
        .from("predictions")
        .select(VIEW_COLUMNS)
        .eq("user_id", userId)
        .eq("client_request_id", requestId)
        .maybeSingle();
      if (error) throw error;
      return data ? toView(data as unknown as Row) : null;
    },

    async countCreatedSince(userId, sinceIso) {
      const { count, error } = await admin
        .from("predictions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("submitted_at", sinceIso);
      if (error) throw error;
      return count ?? 0;
    },

    async hasOpen(userId, assetType, symbol, horizon) {
      const { count, error } = await admin
        .from("predictions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("asset_type", assetType)
        .eq("symbol", symbol)
        .eq("horizon", horizon)
        .eq("status", "open");
      if (error) throw error;
      return (count ?? 0) > 0;
    },

    async insert(row) {
      const { data, error } = await admin.from("predictions").insert(row).select(VIEW_COLUMNS).single();
      if (isDuplicateRequestError(error)) return "duplicate";
      if (error) throw error;
      return toView(data as unknown as Row);
    },

    async list({ username, symbol, status, limit }) {
      let query = reader.from("predictions").select(VIEW_COLUMNS).order("submitted_at", { ascending: false }).limit(limit);

      if (username) {
        const { data: profile } = await reader.from("profiles").select("id").eq("username", username).maybeSingle();
        if (!profile) return [];
        query = query.eq("user_id", profile.id);
      }
      if (symbol) query = query.eq("symbol", symbol);
      if (status === "open") query = query.eq("status", "open");
      if (status === "resolved") query = query.neq("status", "open");

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row) => toView(row as unknown as Row));
    },

    async leaderboard(limit) {
      const { data, error } = await reader
        .from("profiles")
        .select("username, display_name, avatar_url, pred_resolved, pred_wins, pred_points")
        .gt("pred_resolved", 0)
        .order("pred_points", { ascending: false })
        .order("pred_resolved", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        stats: statsOf(row as ProfileJoin),
      }));
    },
  };
}

export { horizonOf };
