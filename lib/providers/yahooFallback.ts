import { getYahooChartQuote, type ChartQuote } from "../apis/yahooChart";
import { bareIndianSymbol, isIndianEquitySymbol } from "../data/instruments/india";
import type { AssetQuote } from "../types/quote";

/**
 * Last-resort quotes from Yahoo's chart endpoint (no key, no crumb).
 *
 * Why it exists: Upstox access tokens expire every day, and when one does
 * every Indian price used to go blank until someone pasted a new token.
 * Yahoo carries the same NSE listing (TCS → TCS.NS), so the fallback is the
 * same security on the same exchange — never a same-named foreign listing.
 * Results are labelled as Yahoo and may be delayed.
 */

export type ChartQuoteLookup = (yahooSymbol: string) => Promise<ChartQuote | null>;

export const FALLBACK_SOURCE = "Yahoo (fallback, may be delayed)";

export function isIndianListing(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  return upper.endsWith(".NS") || upper.endsWith(".BSE") || upper.endsWith(".BO") || isIndianEquitySymbol(upper);
}

/** The Yahoo ticker for a StockSphere symbol: NSE stocks get ".NS", BSE ".BO". */
export function yahooTickerFor(symbol: string): string {
  const upper = symbol.trim().toUpperCase();
  if (!isIndianListing(upper)) return upper;
  const bare = bareIndianSymbol(upper);
  return upper.endsWith(".BSE") || upper.endsWith(".BO") ? `${bare}.BO` : `${bare}.NS`;
}

/** A chart quote as an AssetQuote, or null when it carries no usable price. */
export function chartToAssetQuote(symbol: string, chart: ChartQuote | null): AssetQuote | null {
  if (!chart || typeof chart.price !== "number" || !(chart.price > 0)) return null;
  const quote: AssetQuote = {
    symbol: symbol.toUpperCase(),
    price: chart.price,
    currency: chart.currency ?? (isIndianListing(symbol) ? "INR" : "USD"),
    source: FALLBACK_SOURCE,
  };
  if (chart.change !== null) quote.change = chart.change;
  if (chart.changePercent !== null) quote.changePercent = chart.changePercent;
  if (chart.open !== null) quote.open = chart.open;
  if (chart.high !== null) quote.high = chart.high;
  if (chart.low !== null) quote.low = chart.low;
  if (chart.previousClose !== null) quote.previousClose = chart.previousClose;
  if (chart.volume !== null && chart.volume !== undefined) quote.volume = chart.volume;
  // The exchange's own time for this price — never the time we fetched it.
  if (chart.marketTime) quote.lastUpdated = chart.marketTime;
  return quote;
}

export async function yahooFallbackQuote(symbol: string, lookup: ChartQuoteLookup = getYahooChartQuote): Promise<AssetQuote | null> {
  try {
    return chartToAssetQuote(symbol, await lookup(yahooTickerFor(symbol)));
  } catch {
    return null;
  }
}
