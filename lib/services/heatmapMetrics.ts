import { getNseConstituents, type NseIndexId } from "../apis/niftyIndices";
import { getSpark, type SparkSeries } from "../apis/yahooSpark";
import { US_LARGE_CAPS } from "../analytics/screener";
import {
  RELVOL_MAX_UNIVERSE,
  dailyVolatility,
  extendedHoursChange,
  intradayChange,
  localDate,
  performance,
  relativeVolume,
  type MetricId,
  type PerfPeriod,
} from "../analytics/heatmapMetrics";
import { getHistory, resolveAsset, type History } from "./history";
import type { HeatmapUniverse } from "./heatmap";

/**
 * The heatmap's non-quote colour metrics, computed server-side for a whole
 * universe per request (never one browser request per tile):
 *
 *   daily      Perf 1W…1Y and daily volatility — Yahoo spark, 2 years of
 *              daily closes, 20 symbols per call
 *   intraday   1h / 4h, and US pre/post-market — Yahoo spark, today's
 *              1-minute bars (US with extended hours), 20 symbols per call
 *   volume     relative volume — the cached per-stock daily chart (shared
 *              with the stock pages), so only for universes ≤ 100 stocks
 *
 * A value is null whenever the data doesn't support it exactly.
 */

export const METRIC_SETS = ["daily", "intraday", "volume"] as const;
export type MetricSet = (typeof METRIC_SETS)[number];

/** One metric value with the window it was measured over, for tooltips. */
export type MetricValue = { value: number; from: string; to: string };

export type HeatmapMetrics = {
  universe: HeatmapUniverse;
  set: MetricSet;
  source: string;
  fetchedAt: string;
  values: Record<string, Partial<Record<MetricId, MetricValue | null>>>;
};

export type MetricsError = { error: string; status: 400 | 503 };

export interface MetricsDeps {
  symbols: (universe: HeatmapUniverse) => Promise<string[] | null>;
  spark: (yahooSymbols: string[], params: { range: string; interval: string; prePost?: boolean }) => Promise<Map<string, SparkSeries>>;
  dailyHistory: (yahooSymbol: string) => Promise<History | null>;
  now: () => number;
}

const DEFAULT_DEPS: MetricsDeps = {
  symbols: async (universe) =>
    universe === "us" ? [...US_LARGE_CAPS] : (await getNseConstituents(universe as NseIndexId))?.constituents.map((c) => c.symbol) ?? null,
  spark: (symbols, params) => getSpark(symbols, params),
  dailyHistory: (symbol) => {
    const asset = resolveAsset("stock", symbol);
    return asset ? getHistory(asset, "6mo").catch(() => null) : Promise.resolve(null);
  },
  now: Date.now,
};

const yahooSymbol = (universe: HeatmapUniverse, symbol: string) => (universe === "us" ? symbol : `${symbol}.NS`);

const PERIODS: [MetricId, PerfPeriod][] = [
  ["perf1w", "1W"],
  ["perf1m", "1M"],
  ["perf3m", "3M"],
  ["perf6m", "6M"],
  ["perfytd", "YTD"],
  ["perf1y", "1Y"],
];

const iso = (ms: number) => new Date(ms).toISOString();

export function dailyMetrics(series: SparkSeries | undefined, now: number): Partial<Record<MetricId, MetricValue | null>> {
  const out: Partial<Record<MetricId, MetricValue | null>> = {};
  for (const [id, period] of PERIODS) {
    const p = series ? performance(series, period) : null;
    out[id] = p ? { value: p.value, from: `${p.fromDate} close`, to: `${p.toDate} close` } : null;
  }
  const vol = series ? dailyVolatility(series, now, series.periods.regular) : null;
  out.volatility =
    vol !== null && series ? { value: vol, from: "20 completed sessions", to: series.timeZone && series.times.length ? `${localDate(series.times[series.times.length - 1], series.timeZone)} close` : "" } : null;
  return out;
}

export function intradayMetrics(series: SparkSeries | undefined, us: boolean): Partial<Record<MetricId, MetricValue | null>> {
  const wrap = (r: { value: number; fromTime: number; toTime: number } | null) => (r ? { value: r.value, from: iso(r.fromTime), to: iso(r.toTime) } : null);
  return {
    chg1h: wrap(series ? intradayChange(series, 60) : null),
    chg4h: wrap(series ? intradayChange(series, 240) : null),
    ...(us ? { premarket: wrap(series ? extendedHoursChange(series, "pre") : null), postmarket: wrap(series ? extendedHoursChange(series, "post") : null) } : {}),
  };
}

export async function buildMetrics(universe: HeatmapUniverse, set: MetricSet, deps: MetricsDeps = DEFAULT_DEPS): Promise<HeatmapMetrics | MetricsError> {
  const symbols = await deps.symbols(universe);
  if (!symbols || symbols.length === 0) return { error: "This universe's constituent list is unavailable.", status: 503 };
  const now = deps.now();
  const values: HeatmapMetrics["values"] = {};
  const us = universe === "us";

  if (set === "volume") {
    if (symbols.length > RELVOL_MAX_UNIVERSE) return { error: `Relative volume is offered for universes of up to ${RELVOL_MAX_UNIVERSE} stocks.`, status: 400 };
    let next = 0;
    let any = false;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (next < symbols.length) {
          const symbol = symbols[next++];
          const history = await deps.dailyHistory(yahooSymbol(universe, symbol));
          const rv = history ? relativeVolume(history.candles.map((c) => ({ t: c.t, v: c.v ?? null }))) : null;
          if (history) any = true;
          values[symbol] = { relvol: rv ? { value: rv.value, from: "20-session average", to: `session of ${iso(rv.at).slice(0, 10)}` } : null };
        }
      })
    );
    if (!any) return { error: "Daily volume history is unavailable right now.", status: 503 };
    return { universe, set, source: "Daily bars (Yahoo, Upstox fallback)", fetchedAt: iso(now), values };
  }

  const series =
    set === "daily"
      ? await deps.spark(symbols.map((s) => yahooSymbol(universe, s)), { range: "2y", interval: "1d" })
      : await deps.spark(symbols.map((s) => yahooSymbol(universe, s)), { range: "1d", interval: "1m", prePost: us });
  if (series.size === 0) return { error: "Price history is unavailable right now.", status: 503 };

  for (const symbol of symbols) {
    const s = series.get(yahooSymbol(universe, symbol));
    values[symbol] = set === "daily" ? dailyMetrics(s, now) : intradayMetrics(s, us);
  }
  return { universe, set, source: set === "daily" ? "Yahoo daily closes" : "Yahoo 1-minute bars", fetchedAt: iso(now), values };
}

/* ------------------------------------------------------------ cache */

const TTL_MS: Record<MetricSet, number> = { daily: 10 * 60_000, intraday: 60_000, volume: 10 * 60_000 };
const cache = new Map<string, { at: number; data: HeatmapMetrics }>();
const inFlight = new Map<string, Promise<HeatmapMetrics | MetricsError>>();

export async function getHeatmapMetrics(universe: HeatmapUniverse, set: MetricSet, deps: MetricsDeps = DEFAULT_DEPS): Promise<HeatmapMetrics | MetricsError> {
  const key = `${universe}|${set}`;
  const hit = cache.get(key);
  if (hit && deps.now() - hit.at < TTL_MS[set]) return hit.data;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = buildMetrics(universe, set, deps)
      .then((data) => {
        if (!("error" in data)) cache.set(key, { at: deps.now(), data });
        return data;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

export function clearMetricsCache() {
  cache.clear();
}
