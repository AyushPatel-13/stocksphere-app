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
  /** Upstox instrument key, for Indian indices (which have no NSE equity symbol). */
  upstoxKey?: string | null;
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
      return { type, symbol, yahoo: indian, unit: "points", currency: "INR", name: indianMeta?.name ?? null, upstoxSymbol: null, upstoxKey: indianMeta?.instrumentKey ?? null };
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
  /** The latest session's total volume as the provider reports it; absent when it doesn't. */
  volume?: number | null;
  marketTime: string | null;
  sessionStart: number | null;
  sessionEnd: number | null;
  source: "Yahoo" | "Upstox";
};

/**
 * A session's volume from its 1-minute bars, for when the provider gives no
 * total of its own.
 *
 * The bars can't simply be added up. After the close Yahoo's last bar for an
 * NSE stock holds the whole day's volume, not that minute's: on 10 Nov 2026
 * SBIN's bars summed to 4,62,92,174 while the day's volume was 2,40,65,897,
 * and 2,40,62,689 of the sum was that one last bar. So a last bar at least as
 * large as most of the rest put together is taken as the day's total.
 */
export function sessionVolume(candles: { v: number | null }[]): number | null {
  const volumes = candles.map((c) => c.v).filter((v): v is number => typeof v === "number" && v >= 0);
  if (volumes.length === 0) return null;
  const last = volumes[volumes.length - 1];
  const rest = volumes.slice(0, -1).reduce((a, b) => a + b, 0);
  const total = volumes.length > 10 && last >= rest * 0.8 ? Math.max(last, rest) : rest + last;
  return total > 0 ? total : null;
}

export interface HistoryDeps {
  getYahooSeries: typeof getYahooSeries;
  /** Daily candles from Upstox for a bare NSE symbol, ascending; null if unavailable. */
  getUpstoxDaily: (symbol: string, days: number) => Promise<Candle[] | null>;
  /** The same, by Upstox instrument key (Indian indices). Optional: without it, indices use Yahoo's daily series. */
  getUpstoxDailyByKey?: (instrumentKey: string, days: number) => Promise<Candle[] | null>;
  now: () => number;
}

async function getUpstoxDaily(symbol: string, days: number): Promise<Candle[] | null> {
  try {
    const instrument = await searchUpstoxEquity(symbol);
    if (!instrument?.instrument_key) return null;
    return await getUpstoxDailyByKey(instrument.instrument_key, days);
  } catch {
    return null;
  }
}

async function getUpstoxDailyByKey(instrumentKey: string, days: number): Promise<Candle[] | null> {
  try {
    const to = new Date();
    const from = new Date(to.getTime() - Math.min(days || 3650, 3650) * 86_400_000);
    const iso = (date: Date) => date.toISOString().slice(0, 10);

    const rows = await getUpstoxHistoricalCandles(instrumentKey, iso(from), iso(to));
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

const DEFAULT_DEPS: HistoryDeps = { getYahooSeries, getUpstoxDaily, getUpstoxDailyByKey, now: Date.now };

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

const IST_OFFSET_MS = 5.5 * 3_600_000;
const istDay = (t: number) => Math.floor((t + IST_OFFSET_MS) / 86_400_000);

/**
 * The close of the last Upstox daily candle dated before the day (in India)
 * that `sessionStart` falls on.
 *
 * Upstox stamps a daily candle at midnight IST, so the session's own candle
 * is "earlier" than its 09:15 open by the clock; the comparison is by date.
 * Unlike Yahoo's daily series, Upstox's includes special sessions: Yahoo had
 * no candle for the Diwali Muhurat session of Sunday 8 Nov 2026, so on 9 Nov
 * it measured RELIANCE from Friday's 1320 (+0.33%) while the exchange's
 * previous close was Sunday's 1324 (+0.03%).
 */
export function previousUpstoxClose(daily: Candle[], sessionStart: number): number | null {
  const day = istDay(sessionStart);
  return daily.filter((candle) => istDay(candle.t) < day).at(-1)?.c ?? null;
}

/** Days of Upstox daily candles asked for: enough to span a long holiday break. */
const PREVIOUS_CLOSE_LOOKBACK_DAYS = 12;

/**
 * After the close, Yahoo's last 1-minute bar for an NSE stock carries the
 * whole day's volume instead of that minute's (see sessionVolume in
 * watchlistRows.ts). Left in, it draws one bar a hundred times taller than
 * the rest on the 1D volume panel, so its volume is blanked: unknown, not a
 * made-up minute figure. The day's total is still reported in `volume`.
 */
export function withoutCumulativeLastBar(candles: Candle[]): Candle[] {
  if (candles.length <= 10) return candles;
  const last = candles[candles.length - 1];
  if (typeof last.v !== "number" || last.v <= 0) return candles;
  const rest = candles.slice(0, -1).reduce((sum, candle) => sum + (candle.v ?? 0), 0);
  return last.v >= rest * 0.8 ? [...candles.slice(0, -1), { ...last, v: null }] : candles;
}

export function createHistoryLoader(deps: HistoryDeps = DEFAULT_DEPS) {
  const cache = new Map<string, { at: number; history: History }>();
  const dailyCloses = new Map<string, { at: number; close: number | null }>();

  // One small daily request per symbol and session, kept for 10 minutes.
  // Indian assets ask Upstox first, so the 1D change here matches the quote's
  // (the stock header, the index bar, movers); Yahoo's daily series is the
  // fallback, and the only source for everything else.
  async function dailyPreviousClose(asset: ResolvedAsset, sessionStart: number): Promise<number | null> {
    const key = `${asset.yahoo}|${sessionStart}`;
    const hit = dailyCloses.get(key);
    if (hit && deps.now() - hit.at < 10 * 60_000) return hit.close;

    let close: number | null = null;
    // A BSE chart (.BO) keeps Yahoo's BSE closes: the Upstox symbol is the NSE listing.
    if ((asset.upstoxKey || asset.upstoxSymbol) && !asset.yahoo.endsWith(".BO")) {
      const upstox = await (asset.upstoxKey
        ? deps.getUpstoxDailyByKey?.(asset.upstoxKey, PREVIOUS_CLOSE_LOOKBACK_DAYS)
        : deps.getUpstoxDaily(asset.upstoxSymbol!, PREVIOUS_CLOSE_LOOKBACK_DAYS)
      )?.catch(() => null);
      if (upstox) close = previousUpstoxClose(upstox, sessionStart);
    }
    if (close === null) {
      const daily = await deps.getYahooSeries(asset.yahoo, "5d", "1d");
      close = daily ? previousDailyClose(daily.candles, sessionStart) : null;
    }
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

    const kept = config.trimDays
      ? series.candles.filter((candle) => candle.t >= deps.now() - config.trimDays * 86_400_000)
      : series.candles;
    if (kept.length === 0) return null;
    // The day's total from the bars, before the cumulative one is blanked, for a series without its own.
    const barVolume = range === "1d" ? sessionVolume(kept) : null;
    const candles = range === "1d" ? withoutCumulativeLastBar(kept) : kept;

    const previousClose =
      range === "1d" && source === "Yahoo"
        ? (await dailyPreviousClose(asset, candles[0].t)) ?? series.previousClose
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
      volume: range === "1d" ? series.regularMarketVolume ?? barVolume : null,
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
