import { searchUpstoxEquity } from "../apis/upstox";
import { getUpstoxHistoricalCandles } from "../apis/upstoxHistorical";
import { getYahooSeries, type Candle, type ChartSeries } from "../apis/yahooChart";
import {
  BONDS,
  ETFS,
  INDIAN_INDEX_YAHOO,
  cryptoAsset,
  type AssetType,
  type ValueUnit,
} from "../data/assets";
import { GLOBAL_INDICES, INDIAN_INDICES } from "../data/instruments/indices";
import { bareIndianSymbol, isIndianEquitySymbol } from "../data/instruments/india";
import { isValidSymbol } from "../validation/symbol";

/**
 * Price history for any asset StockSphere shows: stocks, indices, ETFs,
 * crypto and bonds, for one of a fixed set of ranges.
 *
 * Source: Yahoo Finance's chart endpoint for everything (it carries NSE, US,
 * index, crypto and Treasury-yield series with the right currency). For
 * Indian stocks and ETFs, Upstox's official daily candles are the fallback
 * when Yahoo doesn't answer.
 *
 * Money is never converted: an Indian asset is charted in rupees and a US one
 * in dollars, as the source reports it.
 */

// Resolution follows what a chart that wide can show: 1-minute points for a
// day, 5-minute for a week, half-hourly for a month, hourly for three. Yahoo
// has no 3-year range, so 3Y asks for five and keeps the last three.
export const RANGES = {
  "1d": { yahoo: "1d", interval: "1m", ttlMs: 60_000, days: 1, trimDays: 0 },
  "5d": { yahoo: "5d", interval: "5m", ttlMs: 2 * 60_000, days: 5, trimDays: 0 },
  "1mo": { yahoo: "1mo", interval: "30m", ttlMs: 5 * 60_000, days: 31, trimDays: 0 },
  "3mo": { yahoo: "3mo", interval: "1h", ttlMs: 10 * 60_000, days: 92, trimDays: 0 },
  "6mo": { yahoo: "6mo", interval: "1d", ttlMs: 10 * 60_000, days: 183, trimDays: 0 },
  "1y": { yahoo: "1y", interval: "1d", ttlMs: 10 * 60_000, days: 366, trimDays: 0 },
  "3y": { yahoo: "5y", interval: "1wk", ttlMs: 30 * 60_000, days: 1096, trimDays: 1096 },
  "5y": { yahoo: "5y", interval: "1wk", ttlMs: 30 * 60_000, days: 1827, trimDays: 0 },
  max: { yahoo: "max", interval: "1mo", ttlMs: 60 * 60_000, days: 0, trimDays: 0 },
} as const;

export type HistoryRange = keyof typeof RANGES;

export function isHistoryRange(value: string): value is HistoryRange {
  return Object.prototype.hasOwnProperty.call(RANGES, value);
}

export type ResolvedAsset = {
  type: AssetType;
  symbol: string;
  yahoo: string;
  unit: ValueUnit;
  currency: "INR" | "USD" | null;
  name: string | null;
  /** Bare NSE symbol when Upstox can serve as a fallback. */
  upstoxSymbol: string | null;
};

/** Map StockSphere's (type, symbol) to a provider symbol, or null if unknown. */
export function resolveAsset(
  type: AssetType,
  rawSymbol: string,
  vs: "INR" | "USD" = "INR"
): ResolvedAsset | null {
  const symbol = decodeURIComponent(rawSymbol).trim().toUpperCase();
  if (!isValidSymbol(symbol.replace(/^\^/, ""))) return null;

  if (type === "index") {
    const indian = INDIAN_INDEX_YAHOO[symbol];
    const indianMeta = INDIAN_INDICES.find((index) => index.symbol === symbol);
    if (indian) {
      return { type, symbol, yahoo: indian, unit: "points", currency: "INR", name: indianMeta?.name ?? null, upstoxSymbol: null };
    }
    const global = GLOBAL_INDICES.find((index) => index.symbol === symbol);
    return global
      ? { type, symbol, yahoo: global.yahooSymbol, unit: "points", currency: null, name: global.name, upstoxSymbol: null }
      : null;
  }

  if (type === "crypto") {
    const coin = cryptoAsset(symbol, vs);
    return coin
      ? { type, symbol: coin.symbol, yahoo: coin.yahoo, unit: "currency", currency: vs, name: coin.name, upstoxSymbol: null }
      : null;
  }

  if (type === "etf" || type === "bond") {
    const entry = (type === "etf" ? ETFS : BONDS).find((asset) => asset.symbol === symbol);
    return entry
      ? {
          type,
          symbol,
          yahoo: entry.yahoo,
          unit: entry.unit,
          currency: entry.currency,
          name: entry.name,
          upstoxSymbol: entry.region === "india" && entry.unit === "currency" ? entry.symbol : null,
        }
      : null;
  }

  // Stocks. A listed ETF opened from a stock page charts as that ETF.
  const etf = ETFS.find((asset) => asset.symbol === symbol);
  if (etf) {
    return { type, symbol, yahoo: etf.yahoo, unit: "currency", currency: etf.currency, name: etf.name, upstoxSymbol: etf.region === "india" ? etf.symbol : null };
  }

  if (symbol.endsWith(".NS") || symbol.endsWith(".BO") || symbol.endsWith(".BSE") || isIndianEquitySymbol(symbol)) {
    const bare = bareIndianSymbol(symbol);
    const yahoo = symbol.endsWith(".BO") || symbol.endsWith(".BSE") ? `${bare}.BO` : `${bare}.NS`;
    return { type, symbol, yahoo, unit: "currency", currency: "INR", name: null, upstoxSymbol: bare };
  }

  return { type, symbol, yahoo: symbol, unit: "currency", currency: "USD", name: null, upstoxSymbol: null };
}

export type History = {
  type: AssetType;
  symbol: string;
  name: string | null;
  unit: ValueUnit;
  currency: string | null;
  range: HistoryRange;
  interval: string;
  candles: Candle[];
  previousClose: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  marketTime: string | null;
  sessionStart: number | null;
  sessionEnd: number | null;
  source: "Yahoo" | "Upstox";
};

export interface HistoryDeps {
  getYahooSeries: typeof getYahooSeries;
  /** Daily candles from Upstox for a bare NSE symbol, ascending; null if unavailable. */
  getUpstoxDaily: (symbol: string, days: number) => Promise<Candle[] | null>;
  now: () => number;
}

async function getUpstoxDaily(symbol: string, days: number): Promise<Candle[] | null> {
  try {
    const instrument = await searchUpstoxEquity(symbol);
    if (!instrument?.instrument_key) return null;

    const to = new Date();
    const from = new Date(to.getTime() - Math.min(days || 3650, 3650) * 86_400_000);
    const iso = (date: Date) => date.toISOString().slice(0, 10);

    const rows = await getUpstoxHistoricalCandles(instrument.instrument_key, iso(from), iso(to));
    if (!rows) return null;

    return rows
      .flatMap((row) => {
        const [time, o, h, l, c, v] = row as [string, number, number, number, number, number];
        const t = Date.parse(time);
        return Number.isFinite(t) && typeof c === "number"
          ? [{ t, o: o ?? null, h: h ?? null, l: l ?? null, c, v: v ?? null }]
          : [];
      })
      .sort((a, b) => a.t - b.t);
  } catch {
    return null;
  }
}

const DEFAULT_DEPS: HistoryDeps = { getYahooSeries, getUpstoxDaily, now: Date.now };

const MAX_CACHE = 400;

/**
 * The close of the last daily candle that started before `sessionStart`.
 *
 * Yahoo's 1-minute series reports a `previousClose` that can be a session
 * behind (on 28 Oct 2026 BANKNIFTY's said 54366.7, the 26 Oct close, while
 * the 27 Oct close was 53974.9), so the 1D day change is taken from the
 * daily series instead. Null when there is no earlier daily candle.
 */
export function previousDailyClose(daily: Candle[], sessionStart: number): number | null {
  const earlier = daily.filter((candle) => candle.t < sessionStart - 60_000);
  return earlier.at(-1)?.c ?? null;
}

export function createHistoryLoader(deps: HistoryDeps = DEFAULT_DEPS) {
  const cache = new Map<string, { at: number; history: History }>();
  const dailyCloses = new Map<string, { at: number; close: number | null }>();

  // One small daily request per symbol and session, kept for 10 minutes.
  async function dailyPreviousClose(yahoo: string, sessionStart: number): Promise<number | null> {
    const key = `${yahoo}|${sessionStart}`;
    const hit = dailyCloses.get(key);
    if (hit && deps.now() - hit.at < 10 * 60_000) return hit.close;
    const daily = await deps.getYahooSeries(yahoo, "5d", "1d");
    const close = daily ? previousDailyClose(daily.candles, sessionStart) : null;
    if (dailyCloses.size >= MAX_CACHE) dailyCloses.delete(dailyCloses.keys().next().value as string);
    if (close !== null) dailyCloses.set(key, { at: deps.now(), close });
    return close;
  }

  return async function getHistory(asset: ResolvedAsset, range: HistoryRange): Promise<History | null> {
    const config = RANGES[range];
    const key = `${asset.yahoo}|${range}`;
    const hit = cache.get(key);
    if (hit && deps.now() - hit.at < config.ttlMs) return hit.history;

    let series: ChartSeries | null = await deps.getYahooSeries(asset.yahoo, config.yahoo, config.interval);
    let source: History["source"] = "Yahoo";

    const intraday = config.interval.endsWith("m") || config.interval.endsWith("h");
    if ((!series || series.candles.length === 0) && asset.upstoxSymbol && !intraday) {
      const candles = await deps.getUpstoxDaily(asset.upstoxSymbol, config.days);
      if (candles && candles.length > 0) {
        series = {
          name: null,
          currency: "INR",
          exchangeTimezone: "Asia/Kolkata",
          previousClose: null,
          fiftyTwoWeekHigh: null,
          fiftyTwoWeekLow: null,
          regularMarketPrice: candles[candles.length - 1].c,
          marketTime: new Date(candles[candles.length - 1].t).toISOString(),
          sessionStart: null,
          sessionEnd: null,
          candles,
        };
        source = "Upstox";
      }
    }

    if (!series || series.candles.length === 0) return null;

    const candles = config.trimDays
      ? series.candles.filter((candle) => candle.t >= deps.now() - config.trimDays * 86_400_000)
      : series.candles;
    if (candles.length === 0) return null;

    const previousClose =
      range === "1d" && source === "Yahoo"
        ? (await dailyPreviousClose(asset.yahoo, candles[0].t)) ?? series.previousClose
        : series.previousClose;

    const history: History = {
      type: asset.type,
      symbol: asset.symbol,
      name: asset.name ?? series.name,
      unit: asset.unit,
      // Indices are points; everything else keeps the currency the source reports.
      currency: asset.unit === "currency" ? series.currency ?? asset.currency : asset.currency,
      range,
      interval: source === "Upstox" ? "1d" : config.interval,
      candles,
      previousClose,
      fiftyTwoWeekHigh: series.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: series.fiftyTwoWeekLow,
      marketTime: series.marketTime,
      sessionStart: series.sessionStart,
      sessionEnd: series.sessionEnd,
      source,
    };

    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: deps.now(), history });
    return history;
  };
}

export const getHistory = createHistoryLoader();

/**
 * 52-week high and low from a year of history: the provider's own figures
 * when it reports them, otherwise the extremes of the daily bars. Null when
 * there's no usable data — never an estimate.
 */
export function fiftyTwoWeekRange(history: History | null): { high: number; low: number } | null {
  if (!history) return null;
  const { fiftyTwoWeekHigh: high, fiftyTwoWeekLow: low } = history;
  if (high !== null && low !== null && high > 0 && low > 0 && high >= low) return { high, low };

  const highs = history.candles.map((c) => c.h ?? c.c).filter((v): v is number => typeof v === "number" && v > 0);
  const lows = history.candles.map((c) => c.l ?? c.c).filter((v): v is number => typeof v === "number" && v > 0);
  if (highs.length === 0 || lows.length === 0) return null;
  return { high: Math.max(...highs), low: Math.min(...lows) };
}
