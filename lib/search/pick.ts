import { isValidSymbol } from "../validation/symbol";
import { canonicalStockSymbol } from "./canonical";
import type { InstrumentType, SearchResult } from "./types";

/**
 * What a form stores when someone picks a search result. Browser-safe.
 *
 * Stocks and ETFs are stored by StockSphere's canonical stock symbol (bare for
 * the known Indian universe and US tickers, ".NS" for other NSE listings: see
 * ./canonical), which is what the quote path, watchlists and alerts key on.
 * Everything else is stored by its own symbol (NIFTY, BTC, GOLD).
 */
export function storedSymbolFor(result: Pick<SearchResult, "symbol" | "type" | "market">): string {
  return result.type === "stock" || result.type === "etf"
    ? canonicalStockSymbol(result.symbol, result.market)
    : result.symbol.trim().toUpperCase();
}

/** The instrument classes a manual portfolio holding can be valued for. */
export const HOLDING_TYPES: InstrumentType[] = ["stock", "etf"];

/**
 * Why a picked instrument can't be recorded as a holding, or null when it can.
 * `picked` is null when nothing was chosen from the suggestions (typing "SBI"
 * and pressing Save), which is refused rather than saved as a ticker.
 */
export function holdingInstrumentError(picked: { symbol: string; type?: InstrumentType } | null): string | null {
  if (!picked) return "Pick a stock or ETF from the suggestions.";
  if (picked.type && !HOLDING_TYPES.includes(picked.type)) return "Holdings can be stocks or ETFs.";
  if (!isValidSymbol(picked.symbol)) return "That instrument's symbol can't be recorded.";
  return null;
}
