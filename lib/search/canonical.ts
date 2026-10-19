import { bareIndianSymbol, isIndianEquitySymbol } from "../data/instruments/india";

/**
 * The canonical stock symbol StockSphere stores and routes by. Safe to use in
 * the browser (no provider code).
 *
 * An Indian listing outside the app's known universe must carry ".NS": a bare
 * "RPOWER" is routed to the global providers, which may hold a different
 * security under that ticker. Known Indian symbols stay bare ("TCS"), as they
 * are everywhere else in the app; US symbols are unchanged.
 */
export function canonicalStockSymbol(symbol: string, market: "India" | "US" | "Global"): string {
  const upper = symbol.trim().toUpperCase();
  if (market !== "India") return upper;
  const bare = bareIndianSymbol(upper);
  return isIndianEquitySymbol(bare) ? bare : `${bare}.NS`;
}

export function indianStockHref(symbol: string): string {
  return `/stock/${encodeURIComponent(canonicalStockSymbol(symbol, "India"))}`;
}
