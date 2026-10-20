import { downsample } from "./indexOverview";
import { getHistory, resolveAsset, type History } from "./history";
import { isValidSymbol } from "../validation/symbol";

/**
 * Everything one watchlist row shows, for many symbols in one request:
 * price and day change, today's volume, the 52-week range and an intraday
 * sparkline. Built from the cached 1-day chart history (one provider call per
 * symbol per minute at most, shared with the charts), so a 20-stock watchlist
 * is one browser request instead of twenty.
 *
 * A value the provider didn't send is null — never filled in.
 */

export const MAX_WATCHLIST_SYMBOLS = 50;
const CONCURRENCY = 6;

export type WatchlistRow = {
  symbol: string;
  name: string | null;
  currency: string | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  /** Sum of today's intraday bar volumes; null when the source reports none. */
  volume: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  spark: number[];
  /** When the last price was printed (ISO), for "as of". */
  asOf: string | null;
  source: string | null;
};

export function emptyRow(symbol: string): WatchlistRow {
  return {
    symbol,
    name: null,
    currency: null,
    price: null,
    change: null,
    changePercent: null,
    volume: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    spark: [],
    asOf: null,
    source: null,
  };
}

export function toWatchlistRow(symbol: string, history: History | null): WatchlistRow {
  if (!history || history.candles.length === 0) return emptyRow(symbol);

  const candles = history.candles;
  const last = candles[candles.length - 1];
  const price = last.c > 0 ? last.c : null;
  const previous = history.previousClose !== null && history.previousClose > 0 ? history.previousClose : null;
  const change = price !== null && previous !== null ? price - previous : null;
  const volumes = candles.map((c) => c.v).filter((v): v is number => typeof v === "number" && v >= 0);
  const volume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) : null;

  return {
    symbol,
    name: history.name,
    currency: history.currency,
    price,
    change,
    changePercent: change !== null && previous ? (change / previous) * 100 : null,
    volume: volume && volume > 0 ? volume : null,
    fiftyTwoWeekHigh: history.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: history.fiftyTwoWeekLow,
    spark: downsample(candles.map((c) => c.c)),
    asOf: history.marketTime ?? new Date(last.t).toISOString(),
    source: history.source,
  };
}

/** Upper-cased, valid and de-duplicated, in order; at most MAX_WATCHLIST_SYMBOLS. */
export function parseSymbolList(raw: string | null): string[] | null {
  if (!raw) return null;
  const symbols = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    )
  );
  if (symbols.length === 0 || symbols.length > MAX_WATCHLIST_SYMBOLS) return null;
  return symbols.every(isValidSymbol) ? symbols : null;
}

export async function getWatchlistRows(
  symbols: string[],
  load: typeof getHistory = getHistory
): Promise<WatchlistRow[]> {
  const rows: WatchlistRow[] = new Array(symbols.length);
  let next = 0;

  async function worker() {
    while (next < symbols.length) {
      const i = next++;
      const symbol = symbols[i];
      const asset = resolveAsset("stock", symbol);
      const history = asset ? await load(asset, "1d").catch(() => null) : null;
      rows[i] = toWatchlistRow(symbol, history);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, symbols.length) }, worker));
  return rows;
}
