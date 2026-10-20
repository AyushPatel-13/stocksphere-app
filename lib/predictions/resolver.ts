import type { Candle } from "../apis/yahooChart";
import { getHistory, resolveAsset } from "../services/history";
import { getAdminClient } from "../supabase/server";
import { SCORING_V2, configFingerprint, scorePredictionV2, type CallDirection, type Horizon, type ScoringConfig } from "./v2";
import type { ReferenceMode } from "./v2/reference";
import { exchangeTimeZone, findCryptoExit, findSessionExit, SETTLE_MS, type ExitDecision } from "./v2/resolution";

/**
 * Phase 2 resolver: scores predictions whose expiry has passed.
 *
 * For each due prediction it finds the exit (the Nth session's official
 * close; for crypto the first bar at or after expiry), scores it with the
 * versioned v2 rules, and records the result through the database function
 * that writes the result, closes the prediction and recomputes the member's
 * counters in one transaction. Safe to run repeatedly and concurrently: a
 * prediction can only be resolved once.
 */

export type DuePrediction = {
  id: string;
  assetType: "stock" | "index" | "etf" | "crypto";
  symbol: string;
  direction: CallDirection;
  horizon: Horizon;
  targetPrice: number | null;
  referencePrice: number;
  referenceMode: ReferenceMode;
  referenceQuoteTime: string;
  currency: string | null;
  bandPct: number;
  expirySessions: number | null;
  expiresAt: string | null;
  estimatedExpiryAt: string;
};

export type ResolutionRecord = {
  predictionId: string;
  outcome: "correct" | "incorrect" | "flat" | "void" | "review";
  counted: boolean;
  reason: string | null;
  exitPrice: number | null;
  exitSession: string | null;
  exitSource: string | null;
  movePct: number | null;
  bandPct: number;
  regionErrorPct: number | null;
  targetErrorPct: number | null;
  targetReached: boolean | null;
  directionPoints: number;
  targetPoints: number;
  scoringVersion: string;
  configFingerprint: string;
};

export interface ResolverStore {
  due(nowIso: string, limit: number): Promise<DuePrediction[]>;
  /** False when the prediction was already resolved. */
  record(result: ResolutionRecord): Promise<boolean>;
}

export type ExitBars = { candles: Candle[]; source: string; session: { start: number; end: number } | null } | null;

export interface ResolverData {
  daily(assetType: DuePrediction["assetType"], symbol: string): Promise<ExitBars>;
  intraday(symbol: string): Promise<ExitBars>;
}

export function decideExit(p: DuePrediction, bars: ExitBars, now: number): ExitDecision {
  if (p.assetType === "crypto") {
    if (!p.expiresAt) return { kind: "void", reason: "no-expiry" };
    return findCryptoExit({ bars: bars?.candles ?? [], expiresAt: Date.parse(p.expiresAt), now });
  }
  if (!p.expirySessions) return { kind: "void", reason: "no-expiry" };
  return findSessionExit({
    daily: bars?.candles ?? [],
    referenceMode: p.referenceMode,
    referenceQuoteTime: Date.parse(p.referenceQuoteTime),
    expirySessions: p.expirySessions,
    timeZone: exchangeTimeZone(p.currency),
    todaySession: bars?.session ?? null,
    estimatedExpiryAt: Date.parse(p.estimatedExpiryAt),
    now,
  });
}

export function buildRecord(p: DuePrediction, decision: Exclude<ExitDecision, { kind: "wait" }>, source: string | null, config: ScoringConfig = SCORING_V2): ResolutionRecord {
  const base = {
    predictionId: p.id,
    bandPct: p.bandPct,
    scoringVersion: config.version,
    configFingerprint: configFingerprint(config),
  };

  if (decision.kind === "void") {
    return {
      ...base,
      outcome: "void",
      counted: false,
      reason: decision.reason,
      exitPrice: null,
      exitSession: null,
      exitSource: null,
      movePct: null,
      regionErrorPct: null,
      targetErrorPct: null,
      targetReached: null,
      directionPoints: 0,
      targetPoints: 0,
    };
  }

  const score = scorePredictionV2(
    { direction: p.direction, horizon: p.horizon, entry: p.referencePrice, exit: decision.price, bandPct: p.bandPct, target: p.targetPrice },
    config
  );

  return {
    ...base,
    outcome: score.outcome,
    counted: score.counted,
    reason: score.reason,
    exitPrice: decision.price,
    exitSession: decision.session,
    exitSource: source,
    movePct: score.movePct,
    regionErrorPct: score.regionErrorPct,
    targetErrorPct: score.targetErrorPct,
    targetReached: score.targetReached,
    directionPoints: Math.round(score.directionPoints),
    targetPoints: Math.round(score.targetPoints),
  };
}

export async function resolveDuePredictions(
  store: ResolverStore,
  data: ResolverData,
  now: number = Date.now(),
  limit = 100
): Promise<{ resolved: number; waiting: number; failed: number }> {
  // Nothing is due until its estimated expiry has settled.
  const due = await store.due(new Date(now - SETTLE_MS).toISOString(), limit);
  const bars = new Map<string, Promise<ExitBars>>();
  let resolved = 0;
  let waiting = 0;
  let failed = 0;

  for (const p of due) {
    const key = `${p.assetType}|${p.symbol}`;
    if (!bars.has(key)) {
      bars.set(key, (p.assetType === "crypto" ? data.intraday(p.symbol) : data.daily(p.assetType, p.symbol)).catch(() => null));
    }
    const exitBars = await bars.get(key)!;
    const decision = decideExit(p, exitBars, now);

    if (decision.kind === "wait") {
      waiting++;
      continue;
    }

    try {
      if (await store.record(buildRecord(p, decision, exitBars?.source ?? null))) resolved++;
    } catch (error) {
      failed++;
      console.error(`Resolve failed for prediction ${p.id}:`, error);
    }
  }

  return { resolved, waiting, failed };
}

/* ------------------------------------------------------------ live wiring */

export const historyExitData: ResolverData = {
  async daily(assetType, symbol) {
    const asset = resolveAsset(assetType, symbol);
    if (!asset) return null;
    const history = await getHistory(asset, "6mo");
    if (!history) return null;
    const session = history.sessionStart && history.sessionEnd ? { start: history.sessionStart, end: history.sessionEnd } : null;
    return { candles: history.candles, source: history.source.toLowerCase(), session };
  },
  async intraday(symbol) {
    const asset = resolveAsset("crypto", symbol);
    if (!asset) return null;
    const history = await getHistory(asset, "1mo");
    return history ? { candles: history.candles, source: history.source.toLowerCase(), session: null } : null;
  },
};

export function getResolverStore(): ResolverStore | null {
  const admin = getAdminClient();
  if (!admin) return null;

  return {
    async due(cutoffIso, limit) {
      const { data, error } = await admin
        .from("predictions")
        .select(
          "id, asset_type, symbol, direction, horizon, target_price, reference_price, reference_mode, reference_quote_time, currency, band_pct, expiry_sessions, expires_at, estimated_expiry_at"
        )
        .eq("status", "open")
        .lte("estimated_expiry_at", cutoffIso)
        .order("estimated_expiry_at", { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        assetType: row.asset_type,
        symbol: row.symbol,
        direction: row.direction,
        horizon: row.horizon,
        targetPrice: row.target_price === null ? null : Number(row.target_price),
        referencePrice: Number(row.reference_price),
        referenceMode: row.reference_mode,
        referenceQuoteTime: row.reference_quote_time,
        currency: row.currency,
        bandPct: Number(row.band_pct),
        expirySessions: row.expiry_sessions,
        expiresAt: row.expires_at,
        estimatedExpiryAt: row.estimated_expiry_at,
      }));
    },

    async record(r) {
      const { data, error } = await admin.rpc("prediction_record_resolution", {
        p_prediction: r.predictionId,
        p_outcome: r.outcome,
        p_counted: r.counted,
        p_reason: r.reason,
        p_exit_price: r.exitPrice,
        p_exit_session: r.exitSession,
        p_exit_source: r.exitSource,
        p_move_pct: r.movePct,
        p_band_pct: r.bandPct,
        p_region_error_pct: r.regionErrorPct,
        p_target_error_pct: r.targetErrorPct,
        p_target_reached: r.targetReached,
        p_direction_points: r.directionPoints,
        p_target_points: r.targetPoints,
        p_scoring_version: r.scoringVersion,
        p_config_fingerprint: r.configFingerprint,
      });
      if (error) throw error;
      return data === true;
    },
  };
}
