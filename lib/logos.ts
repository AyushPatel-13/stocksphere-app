import { CRYPTO, ETFS } from "./data/assets";
import { bareIndianSymbol, isIndianEquitySymbol } from "./data/instruments/india";

/**
 * Company logos.
 *
 * Images come from Financial Modeling Prep's public logo set
 * (financialmodelingprep.com/image-stock/<SYMBOL>.png), which covers NSE
 * listings as "<SYMBOL>.NS", US tickers as-is and crypto as "<COIN>USD". The
 * browser never calls FMP directly: /api/logo fetches and caches the image,
 * so visitors' IPs aren't sent to a third party and the source can be swapped
 * in one place. Anything without a logo falls back to the coloured initial.
 */

export type LogoMarket = "India" | "US" | "Global";
export type LogoType = "stock" | "etf" | "index" | "crypto" | "bond";

/** The FMP image symbol for an instrument, or null when none applies. */
export function logoSourceSymbol(symbol: string, market?: LogoMarket, type: LogoType = "stock"): string | null {
  const upper = symbol.trim().toUpperCase();
  if (!upper || type === "index" || type === "bond") return null;

  if (type === "crypto") {
    return CRYPTO.some((coin) => coin.symbol === upper) ? `${upper}USD` : null;
  }

  // A listed ETF knows its own market.
  if (type === "etf" && market === undefined) {
    const etf = ETFS.find((entry) => entry.symbol === upper);
    if (etf) market = etf.region === "india" ? "India" : "US";
  }

  const suffixed = /\.(NS|BSE|BO)$/.test(upper);
  const indian = market === "India" || suffixed || (market === undefined && isIndianEquitySymbol(upper));

  if (indian) return `${bareIndianSymbol(upper)}.NS`;
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(upper) ? upper : null;
}

/** The app URL for an instrument's logo, or null when there is none to try. */
export function logoUrl(symbol: string, market?: LogoMarket, type: LogoType = "stock"): string | null {
  const source = logoSourceSymbol(symbol, market, type);
  return source ? `/api/logo?s=${encodeURIComponent(source)}` : null;
}
