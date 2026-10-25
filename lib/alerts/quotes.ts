import { fromUpstox } from "../adapters/quote.adapter";
import { getUpstoxQuotes, searchUpstoxEquity } from "../apis/upstox";
import { getYahooSeries, type ChartSeries } from "../apis/yahooChart";
import { INDIAN_INDICES } from "../data/instruments/indices";
import { resolveAsset, type ResolvedAsset } from "../services/history";
import type { AlertAssetType } from "./rules";

/**
 * Prices for one alert run, fetched in bulk and stamped with where and when
 * they came from.
 *
 *   Indian stocks, ETFs and indices   one Upstox market-quote call for all of
 *                                     them (up to 500 keys per call), real-time
 *                                     during NSE hours; Yahoo for any Upstox misses
 *   US stocks/ETFs, global indices    Yahoo chart (1 request per symbol, no quota)
 *   Crypto in rupees                  the coin's USD pair × USD/INR, the same
 *                                     conversion paper trading uses, because
 *                                     Yahoo's INR pairs go stale
 *
 * Twelve Data and Alpha Vantage are never used: alerts must not spend the
 * free-tier credits the pages need. Anything that can't be priced with a
 * timestamp is absent from the result, never estimated.
 */

export type AlertMarket = "IN" | "US" | "CRYPTO" | "OTHER";

export type PricedQuote = {
  price: number;
  /** vs the previous session's close; null when that close isn't known. */
  changePercent: number | null;
  currency: string | null;
  source: "Upstox" | "Yahoo";
  /** When the exchange last priced it (epoch ms), not when it was fetched. */
  quoteTime: number;
};

export type AlertInstrument = { assetType: AlertAssetType; symbol: string };

export const instrumentKey = (i: AlertInstrument) => `${i.assetType}|${i.symbol}`;

/** Which trading timetable an alert follows. */
export function marketOf(asset: ResolvedAsset): AlertMarket {
  if (asset.type === "crypto") return "CRYPTO";
  if (asset.currency === "INR" || asset.yahoo.endsWith(".NS") || asset.yahoo.endsWith(".BO") || INDIAN_INDICES.some((i) => i.symbol === asset.symbol && asset.type === "index")) return "IN";
  if (asset.currency === "USD") return "US";
  return "OTHER";
}

export interface AlertQuoteDeps {
  upstoxKey: (asset: ResolvedAsset) => Promise<string | null>;
  upstoxQuotes: (keys: string[]) => Promise<unknown>;
  yahooSeries: (yahooSymbol: string) => Promise<ChartSeries | null>;
}

const UPSTOX_BATCH = 500;
const YAHOO_CONCURRENCY = 8;

async function upstoxKey(asset: ResolvedAsset): Promise<string | null> {
  const index = asset.type === "index" ? INDIAN_INDICES.find((entry) => entry.symbol === asset.symbol) : null;
  if (index) return index.instrumentKey;
  if (!asset.upstoxSymbol) return null;
  try {
    return (await searchUpstoxEquity(asset.upstoxSymbol))?.instrument_key ?? null;
  } catch {
    return null;
  }
}

async function upstoxQuotes(keys: string[]): Promise<unknown> {
  try {
    return await getUpstoxQuotes(keys);
  } catch {
    // Missing token: Yahoo is next in line.
    return null;
  }
}

export const DEFAULT_ALERT_QUOTE_DEPS: AlertQuoteDeps = {
  upstoxKey,
  upstoxQuotes,
  yahooSeries: (symbol) => getYahooSeries(symbol, "1d", "1d"),
};

const pct = (price: number, previous: number | null) => (previous && previous > 0 ? ((price - previous) / previous) * 100 : null);

/**
 * The day move from an Upstox quote. Index quotes carry no prev_close_price
 * (null for NSE_INDEX|Nifty 50, verified 25 Oct 2026) but do carry net_change,
 * so the previous close is price − net_change there.
 */
function upstoxDayMove(price: number, previousClose: number | undefined, change: number | undefined): number | null {
  const previous = previousClose && previousClose > 0 ? previousClose : change !== undefined && change !== 0 ? price - change : null;
  return previous && previous > 0 && change !== undefined ? (change / previous) * 100 : null;
}

/** An Upstox quote for one key, or null when it's missing, unpriced or untimed. */
export function upstoxAlertQuote(raw: unknown, key: string): PricedQuote | null {
  try {
    const quote = fromUpstox(raw, key);
    const time = quote.lastUpdated ? Date.parse(quote.lastUpdated) : NaN;
    if (!(quote.price > 0) || !Number.isFinite(time)) return null;
    return {
      price: quote.price,
      changePercent: upstoxDayMove(quote.price, quote.previousClose, quote.change),
      currency: "INR",
      source: "Upstox",
      quoteTime: time,
    };
  } catch {
    return null;
  }
}

export function yahooAlertQuote(series: ChartSeries | null): PricedQuote | null {
  const price = series?.regularMarketPrice ?? null;
  const time = series?.marketTime ? Date.parse(series.marketTime) : NaN;
  if (!price || price <= 0 || !Number.isFinite(time)) return null;
  return { price, changePercent: pct(price, series!.previousClose), currency: series!.currency, source: "Yahoo", quoteTime: time };
}

/** The FX rate may be this old: currency markets close at weekends, coins don't. */
export const MAX_FX_AGE_MS = 3 * 24 * 60 * 60_000;

/**
 * A rupee coin price from its USD pair and USD/INR. The previous close is
 * converted the same way, so the day move includes the currency's move too.
 * Timed by the coin's own quote — that's the price that moves — with the FX
 * rate required to be no more than MAX_FX_AGE_MS older than it. (On a Sunday
 * Yahoo's USD/INR time lagged BTC-USD by 36 minutes, verified 25 Oct 2026, so
 * taking the older time made every weekend coin quote look stale.)
 */
export function convertedCryptoAlertQuote(usd: ChartSeries | null, fx: ChartSeries | null): PricedQuote | null {
  const u = yahooAlertQuote(usd);
  const f = yahooAlertQuote(fx);
  if (!u || !f || u.quoteTime - f.quoteTime > MAX_FX_AGE_MS) return null;
  const price = u.price * f.price;
  const previous = usd!.previousClose && fx!.previousClose ? usd!.previousClose * fx!.previousClose : null;
  return { price, changePercent: pct(price, previous), currency: "INR", source: "Yahoo", quoteTime: u.quoteTime };
}

async function mapLimited<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await task(items[i]);
      }
    })
  );
  return out;
}

export async function getAlertQuotes(
  instruments: AlertInstrument[],
  deps: AlertQuoteDeps = DEFAULT_ALERT_QUOTE_DEPS
): Promise<Map<string, PricedQuote>> {
  const result = new Map<string, PricedQuote>();
  const unique = Array.from(new Map(instruments.map((i) => [instrumentKey(i), i])).values());

  const resolved = unique
    .map((i) => ({ key: instrumentKey(i), asset: i.assetType === "ipo" ? null : resolveAsset(i.assetType, i.symbol) }))
    .filter((r): r is { key: string; asset: ResolvedAsset } => r.asset !== null);

  // 1. Indian instruments: one Upstox call per 500 keys.
  const indian = resolved.filter((r) => marketOf(r.asset) === "IN");
  const keyed = await mapLimited(indian, YAHOO_CONCURRENCY, async (r) => ({ ...r, upstox: await deps.upstoxKey(r.asset) }));
  const withKeys = keyed.filter((r): r is typeof r & { upstox: string } => r.upstox !== null);
  for (let i = 0; i < withKeys.length; i += UPSTOX_BATCH) {
    const batch = withKeys.slice(i, i + UPSTOX_BATCH);
    const raw = await deps.upstoxQuotes(batch.map((r) => r.upstox));
    for (const r of batch) {
      const quote = upstoxAlertQuote(raw, r.upstox);
      if (quote) result.set(r.key, quote);
    }
  }

  // 2. Everything still unpriced: Yahoo, a few requests at a time.
  const rest = resolved.filter((r) => !result.has(r.key));
  const series = new Map<string, Promise<ChartSeries | null>>();
  const load = (symbol: string) => {
    if (!series.has(symbol)) series.set(symbol, deps.yahooSeries(symbol).catch(() => null));
    return series.get(symbol)!;
  };
  await mapLimited(rest, YAHOO_CONCURRENCY, async (r) => {
    const quote =
      r.asset.type === "crypto" && r.asset.currency === "INR"
        ? convertedCryptoAlertQuote(await load(`${r.asset.symbol}-USD`), await load("USDINR=X"))
        : yahooAlertQuote(await load(r.asset.yahoo));
    if (quote) result.set(r.key, quote);
  });

  return result;
}
