import { checkContent } from "../community/rules";
import type { Candle } from "../apis/yahooChart";
import { getHistory, resolveAsset, type HistoryRange } from "../services/history";
import { getAdminClient, getPublicClient } from "../supabase/server";
import {
  checkNewPrediction,
  horizonOf,
  resolvesAt,
  scorePrediction,
  targetOnRightSide,
  type Direction,
  type Horizon,
  type PredictionAssetType,
  type PredictionStats,
} from "./rules";

/**
 * Predictions: created, resolved and ranked here, and only here.
 *
 * Fairness comes from two things the client never controls: the entry price
 * is read by the server at the moment of prediction, and the exit price is
 * the first real close at or after the deadline, from the same source.
 */

export type PredictionView = {
  id: string;
  assetType: PredictionAssetType;
  symbol: string;
  direction: Direction;
  horizon: Horizon;
  targetPrice: number | null;
  entryPrice: number;
  currency: string | null;
  createdAt: string;
  resolvesAt: string;
  status: "open" | "won" | "lost" | "void";
  exitPrice: number | null;
  resolvedAt: string | null;
  points: number;
  note: string | null;
  user: { username: string; displayName: string; avatarUrl: string | null; stats: PredictionStats };
};

export type LeaderRow = {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  stats: PredictionStats;
};

export type NewPredictionRow = {
  user_id: string;
  asset_type: PredictionAssetType;
  symbol: string;
  direction: Direction;
  horizon: Horizon;
  target_price: number | null;
  entry_price: number;
  currency: string | null;
  resolves_at: string;
  note: string | null;
};

export type DuePrediction = {
  id: string;
  userId: string;
  assetType: PredictionAssetType;
  symbol: string;
  direction: Direction;
  horizon: Horizon;
  entryPrice: number;
  targetPrice: number | null;
  resolvesAt: string;
};

export interface PredictionStore {
  verifyToken(token: string): Promise<string | null>;
  hasProfile(userId: string): Promise<boolean>;
  countCreatedSince(userId: string, sinceIso: string): Promise<number>;
  hasOpen(userId: string, assetType: string, symbol: string, horizon: string): Promise<boolean>;
  insert(row: NewPredictionRow): Promise<PredictionView>;
  list(query: { username?: string; symbol?: string; status?: "open" | "resolved"; limit: number }): Promise<PredictionView[]>;
  due(nowIso: string, limit: number): Promise<DuePrediction[]>;
  /** Close an open prediction; false when it was already resolved. */
  resolve(id: string, result: { status: "won" | "lost" | "void"; exit_price: number; points: number; resolved_at: string }): Promise<boolean>;
  /** Recompute a member's counters from their resolved predictions. */
  recomputeStats(userId: string): Promise<void>;
  leaderboard(limit: number): Promise<LeaderRow[]>;
}

export interface PriceSource {
  /** Latest price (and its currency) for the asset, or null. */
  latest(assetType: PredictionAssetType, symbol: string): Promise<{ price: number; currency: string | null } | null>;
  /** The first close at or after `at`, or null if the market hasn't printed one yet. */
  closeAtOrAfter(assetType: PredictionAssetType, symbol: string, at: number, now: number): Promise<number | null>;
}

const ASSET_TYPES: PredictionAssetType[] = ["stock", "index", "etf", "crypto"];

/* ------------------------------------------------------------ create */

export type CreateResult =
  | { ok: true; prediction: PredictionView }
  | { ok: false; status: number; error: string; code?: string };

export async function createPrediction(
  input: {
    token: string | null;
    assetType: unknown;
    symbol: unknown;
    direction: unknown;
    horizon: unknown;
    target?: unknown;
    note?: unknown;
  },
  store: PredictionStore | null,
  prices: PriceSource,
  now: number = Date.now()
): Promise<CreateResult> {
  if (!store) return { ok: false, status: 503, error: "Predictions aren't set up yet.", code: "NOT_CONFIGURED" };
  if (!input.token) return { ok: false, status: 401, error: "Sign in to make predictions.", code: "SIGNED_OUT" };

  const userId = await store.verifyToken(input.token);
  if (!userId) return { ok: false, status: 401, error: "Your session expired. Please sign in again.", code: "SIGNED_OUT" };
  if (!(await store.hasProfile(userId))) {
    return { ok: false, status: 403, error: "Pick your @handle before predicting.", code: "NO_PROFILE" };
  }

  const assetType = (ASSET_TYPES.includes(input.assetType as PredictionAssetType) ? input.assetType : "stock") as PredictionAssetType;
  const resolved = typeof input.symbol === "string" ? resolveAsset(assetType, input.symbol) : null;
  if (!resolved) return { ok: false, status: 400, error: "We don't recognise that symbol." };
  const symbol = resolved.symbol;

  const [todayCount, openOnSameCall] = await Promise.all([
    store.countCreatedSince(userId, new Date(now - 86_400_000).toISOString()),
    typeof input.horizon === "string" ? store.hasOpen(userId, assetType, symbol, input.horizon) : Promise.resolve(false),
  ]);

  const check = checkNewPrediction({
    direction: input.direction,
    horizon: input.horizon,
    target: input.target,
    todayCount,
    openOnSameCall,
  });
  if (!check.ok) return { ok: false, status: 422, error: check.reason, code: "RULES" };

  let note: string | null = null;
  if (typeof input.note === "string" && input.note.trim()) {
    const verdict = checkContent(input.note.slice(0, 280), false);
    if (!verdict.ok) return { ok: false, status: 422, error: verdict.reason, code: "RULES" };
    note = verdict.body;
  }

  const quote = await prices.latest(assetType, symbol);
  if (!quote) {
    return { ok: false, status: 503, error: "We couldn't get a live price for this right now. Try again shortly." };
  }

  const direction = input.direction as Direction;
  const target =
    input.target === null || input.target === undefined || input.target === "" ? null : Number(input.target);

  if (!targetOnRightSide(direction, quote.price, target)) {
    return {
      ok: false,
      status: 422,
      error: direction === "up" ? "For an Up call, the target must be above the current price." : "For a Down call, the target must be below the current price.",
      code: "RULES",
    };
  }

  const prediction = await store.insert({
    user_id: userId,
    asset_type: assetType,
    symbol,
    direction,
    horizon: input.horizon as Horizon,
    target_price: target,
    entry_price: quote.price,
    currency: quote.currency,
    resolves_at: resolvesAt(now, input.horizon as Horizon).toISOString(),
    note,
  });

  return { ok: true, prediction };
}

/* ------------------------------------------------------------ resolve */

/**
 * Score every due prediction that the market has printed a price for. Safe to
 * run repeatedly and concurrently: a prediction is only closed once (the
 * store's conditional update), and counters are recomputed from scratch.
 */
export async function resolveDue(
  store: PredictionStore,
  prices: PriceSource,
  now: number = Date.now(),
  limit = 25
): Promise<{ resolved: number; pending: number }> {
  const due = await store.due(new Date(now).toISOString(), limit);
  const touched = new Set<string>();
  let resolved = 0;

  for (const prediction of due) {
    const exit = await prices.closeAtOrAfter(prediction.assetType, prediction.symbol, Date.parse(prediction.resolvesAt), now);
    if (exit === null) continue;

    const outcome = scorePrediction({
      direction: prediction.direction,
      horizon: prediction.horizon,
      entry: prediction.entryPrice,
      exit,
      target: prediction.targetPrice,
    });

    const closed = await store.resolve(prediction.id, {
      status: outcome.status,
      exit_price: exit,
      points: outcome.points,
      resolved_at: new Date(now).toISOString(),
    });

    if (closed) {
      resolved++;
      touched.add(prediction.userId);
    }
  }

  for (const userId of touched) await store.recomputeStats(userId);

  return { resolved, pending: due.length - resolved };
}

/* ------------------------------------------------------------ prices */

function rangeFor(ageMs: number): HistoryRange {
  if (ageMs < 25 * 86_400_000) return "1mo";
  if (ageMs < 170 * 86_400_000) return "6mo";
  return "1y";
}

export const historyPrices: PriceSource = {
  async latest(assetType, symbol) {
    const asset = resolveAsset(assetType, symbol);
    if (!asset) return null;
    const history = await getHistory(asset, "1d");
    const last = history?.candles.at(-1);
    return last ? { price: last.c, currency: history?.currency ?? null } : null;
  },

  async closeAtOrAfter(assetType, symbol, at, now) {
    const asset = resolveAsset(assetType, symbol);
    if (!asset) return null;
    const history = await getHistory(asset, rangeFor(now - at));
    return firstCloseAtOrAfter(history?.candles ?? [], at);
  },
};

export function firstCloseAtOrAfter(candles: Candle[], at: number): number | null {
  return candles.find((candle) => candle.t >= at)?.c ?? null;
}

/* ------------------------------------------------------------ Supabase store */

const VIEW_COLUMNS =
  "id, asset_type, symbol, direction, horizon, target_price, entry_price, currency, created_at, resolves_at, status, exit_price, resolved_at, points, note, user:profiles!predictions_user_id_fkey(username, display_name, avatar_url, pred_resolved, pred_wins, pred_points)";

type Row = {
  id: string;
  asset_type: PredictionAssetType;
  symbol: string;
  direction: Direction;
  horizon: Horizon;
  target_price: number | string | null;
  entry_price: number | string;
  currency: string | null;
  created_at: string;
  resolves_at: string;
  status: PredictionView["status"];
  exit_price: number | string | null;
  resolved_at: string | null;
  points: number;
  note: string | null;
  user: ProfileJoin | ProfileJoin[] | null;
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
  return {
    id: row.id,
    assetType: row.asset_type,
    symbol: row.symbol,
    direction: row.direction,
    horizon: row.horizon,
    targetPrice: numOrNull(row.target_price),
    entryPrice: Number(row.entry_price),
    currency: row.currency,
    createdAt: row.created_at,
    resolvesAt: row.resolves_at,
    status: row.status,
    exitPrice: numOrNull(row.exit_price),
    resolvedAt: row.resolved_at,
    points: row.points,
    note: row.note,
    user: {
      username: user?.username ?? "deleted",
      displayName: user?.display_name ?? "Deleted user",
      avatarUrl: user?.avatar_url ?? null,
      stats: statsOf(user),
    },
  };
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

    async countCreatedSince(userId, sinceIso) {
      const { count, error } = await admin
        .from("predictions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", sinceIso);
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
      if (error) throw error;
      return toView(data as unknown as Row);
    },

    async list({ username, symbol, status, limit }) {
      let query = reader.from("predictions").select(VIEW_COLUMNS).order("created_at", { ascending: false }).limit(limit);

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

    async due(nowIso, limit) {
      const { data, error } = await admin
        .from("predictions")
        .select("id, user_id, asset_type, symbol, direction, horizon, entry_price, target_price, resolves_at")
        .eq("status", "open")
        .lte("resolves_at", nowIso)
        .order("resolves_at", { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        userId: row.user_id,
        assetType: row.asset_type,
        symbol: row.symbol,
        direction: row.direction,
        horizon: row.horizon,
        entryPrice: Number(row.entry_price),
        targetPrice: row.target_price === null ? null : Number(row.target_price),
        resolvesAt: row.resolves_at,
      }));
    },

    async resolve(id, result) {
      const { data, error } = await admin
        .from("predictions")
        .update(result)
        .eq("id", id)
        .eq("status", "open")
        .select("id");
      if (error) throw error;
      return (data ?? []).length > 0;
    },

    async recomputeStats(userId) {
      const { data, error } = await admin
        .from("predictions")
        .select("status, points")
        .eq("user_id", userId)
        .in("status", ["won", "lost"]);
      if (error) throw error;

      const rows = data ?? [];
      const { error: updateError } = await admin
        .from("profiles")
        .update({
          pred_resolved: rows.length,
          pred_wins: rows.filter((row) => row.status === "won").length,
          pred_points: rows.reduce((sum, row) => sum + (row.points ?? 0), 0),
        })
        .eq("id", userId);
      if (updateError) throw updateError;
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
