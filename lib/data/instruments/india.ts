export const NIFTY_50_SYMBOLS = [
  "ADANIENT",
  "ADANIPORTS",
  "APOLLOHOSP",
  "ASIANPAINT",
  "AXISBANK",
  "BAJAJ-AUTO",
  "BAJFINANCE",
  "BAJAJFINSV",
  "BEL",
  "BHARTIARTL",
  "CIPLA",
  "COALINDIA",
  "DRREDDY",
  "EICHERMOT",
  "ETERNAL",
  "GRASIM",
  "HCLTECH",
  "HDFCBANK",
  "HDFCLIFE",
  "HEROMOTOCO",
  "HINDALCO",
  "HINDUNILVR",
  "ICICIBANK",
  "INDUSINDBK",
  "INFY",
  "ITC",
  "JINDALSTEL",
  "JSWSTEEL",
  "KOTAKBANK",
  "LT",
  "M&M",
  "MARUTI",
  "MAXHEALTH",
  "NESTLEIND",
  "NTPC",
  "ONGC",
  "POWERGRID",
  "RELIANCE",
  "SBILIFE",
  "SHRIRAMFIN",
  "SBIN",
  "SUNPHARMA",
  "TATACONSUM",
  "TMPV",
  "TATASTEEL",
  "TCS",
  "TECHM",
  "TITAN",
  "TRENT",
  "ULTRACEMCO",
  "WIPRO",
] as const;

export type Nifty50Symbol =
  (typeof NIFTY_50_SYMBOLS)[number];

/**
 * Indian (NSE) equities the app knows about that are not NIFTY 50 constituents:
 * the "India" section of lib/stocks.ts minus the names already listed above.
 * HAL and TATAMOTORS are the only two.
 */
const OTHER_KNOWN_INDIAN_SYMBOLS = ["HAL", "TATAMOTORS"] as const;

/**
 * Every Indian equity symbol this app knows, bare and uppercase.
 *
 * This is the single place that answers "is this an Indian equity?". It exists
 * because routing used to be decided by the ".NS"/".BSE" suffix alone, so a bare
 * Indian ticker such as "INFY" fell through to the global provider chain, where
 * TwelveData resolves it to the Infosys NYSE ADR — a different security at a
 * different currency. Callers must not re-derive this from a suffix; ask here.
 */
export const INDIAN_EQUITY_SYMBOLS: ReadonlySet<string> = new Set<string>([
  ...NIFTY_50_SYMBOLS,
  ...OTHER_KNOWN_INDIAN_SYMBOLS,
]);

/**
 * The canonical Indian symbol format used throughout the app: the bare NSE
 * trading symbol with an ".NS" suffix, e.g. "TCS.NS".
 */
export const NSE_SUFFIX = ".NS";
export const BSE_SUFFIX = ".BSE";

/**
 * Reduce any spelling of an Indian symbol to the bare NSE trading symbol that
 * Upstox's instrument search expects: "TCS.NS", "TCS.BSE" and "tcs" all give
 * "TCS". The suffix is a display/disambiguation convention only — Upstox has no
 * concept of it and its search matches the trading symbol exactly.
 */
export function bareIndianSymbol(symbol: string): string {
  return symbol.replace(/\.(NS|BSE)$/i, "").trim().toUpperCase();
}

/**
 * Whether a symbol denotes an Indian equity, in any spelling.
 *
 * Deliberately case-insensitive: "tcs" and "tcs.ns" are recognised. Accepting a
 * lowercase spelling can only ever route a symbol toward Upstox (which either
 * answers correctly or returns nothing), never toward a global provider holding
 * a same-named different security, so the widening is safe in the one direction
 * that matters.
 */
export function isIndianEquitySymbol(symbol: string): boolean {
  const bare = bareIndianSymbol(symbol);
  return bare.length > 0 && INDIAN_EQUITY_SYMBOLS.has(bare);
}

/**
 * The canonical Indian representation of a symbol: "TCS" and "tcs" become
 * "TCS.NS"; an already-suffixed symbol keeps the suffix it came with; a symbol
 * that is not a known Indian equity is returned unchanged.
 */
export function toCanonicalIndianSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();

  if (upper.endsWith(NSE_SUFFIX) || upper.endsWith(BSE_SUFFIX)) return upper;

  return isIndianEquitySymbol(upper) ? `${upper}${NSE_SUFFIX}` : symbol;
}