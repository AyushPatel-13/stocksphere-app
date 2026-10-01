/**
 * What a symbol arriving from an HTTP query string is allowed to be.
 *
 * /api/market took ?symbol= off the URL with nothing but a trim(), and that
 * value was interpolated straight into provider URLs. "AAPL&outputsize=5000"
 * therefore appended query parameters to the upstream request instead of
 * naming a symbol. The provider clients now percent-encode their values (see
 * lib/apis/twelvedata.ts, lib/apis/finnhub.ts and lib/apis/finnhubFinancials.ts),
 * so a value can no longer break out of the symbol position — this is the
 * second layer, refusing the obviously malformed before any provider is
 * contacted at all.
 *
 * The allowlist is deliberately permissive, because it has to admit every
 * symbol StockSphere actually routes:
 *
 *   TCS  TCS.NS  RELIANCE  RELIANCE.NS  RELIANCE.BSE   Indian (NSE/BSE)
 *   AAPL  MSFT  BRK.B                                  global tickers
 *   M&M  BAJAJ-AUTO                                    real NSE tickers
 *
 * so "." (the .NS/.BSE suffix and share classes such as BRK.B), "-"
 * (BAJAJ-AUTO) and "&" (M&M) are all allowed. Everything outside those
 * characters is refused: "=", "/", "?", "#", "%", "+", whitespace, "<" and any
 * non-ASCII byte.
 *
 * "&" is the one character worth justifying. It is permitted because M&M is a
 * real Nifty 50 constituent this app already handles, not because it is safe
 * in a URL — it is not, which is exactly why percent-encoding it is now
 * mandatory at the provider boundary rather than optional. Validation alone
 * would never be enough: "AAPL&x" passes this test and is still only inert
 * because it gets encoded.
 */

/**
 * The 20-character cap the Agent's tools already apply to a symbol
 * (lib/agent/tools/priceTool.ts and its siblings).
 */
export const MAX_SYMBOL_LENGTH = 20;

/** Must start alphanumeric, then alphanumerics and the separators above. */
const SYMBOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.&-]*$/;

export function isValidSymbol(symbol: string): boolean {
  return (
    symbol.length > 0 &&
    symbol.length <= MAX_SYMBOL_LENGTH &&
    SYMBOL_PATTERN.test(symbol)
  );
}
