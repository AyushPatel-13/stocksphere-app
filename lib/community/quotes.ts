import type { AssetQuote } from "../types/quote";
import type { StoredMention } from "./mentions";

/**
 * The price preview on a post's stock tag: a verified NSE equity's last
 * price and day change, straight from the market-data provider (Upstox,
 * the stock page's source). Never inferred from posts. A quote that can't
 * be matched to the tag's own symbol, or doesn't come back in time, is left
 * out; the tag then shows without a price.
 */

export type StockQuote = {
  price: number;
  change: number | null;
  changePercent: number | null;
  currency: string;
  /** When the market set the price (ISO), if the provider said. */
  asOf: string | null;
  source: string;
};

/** Fetches quotes for bare NSE symbols in one batch (getIndianMarketQuotes in production). */
export type QuoteBatch = (symbols: string[]) => Promise<AssetQuote[]>;

export const QUOTE_TTL_MS = 60_000;
export const QUOTE_TIMEOUT_MS = 2_500;
/** Most symbols priced per page of posts. */
export const MAX_QUOTED = 20;

/**
 * The bare NSE symbol to price for a mention, or null: only listed stocks on
 * NSE (the exchange the provider quotes), never indices, ETFs or BSE tags,
 * whose NSE price would be a different listing's.
 */
export function quotableSymbol(mention: StoredMention): string | null {
  if (mention.kind !== "instrument" || mention.type !== "stock" || mention.exchange !== "NSE") return null;
  const bare = mention.symbol.replace(/\.NS$/i, "").toUpperCase();
  return /^[A-Z0-9][A-Z0-9&-]{0,19}$/.test(bare) ? bare : null;
}

/** A provider quote as a preview, if it really is this symbol's and has a usable price. */
export function toStockQuote(symbol: string, quote: AssetQuote | undefined): StockQuote | null {
  if (!quote || quote.symbol.replace(/\.NS$/i, "").toUpperCase() !== symbol) return null;
  if (!Number.isFinite(quote.price) || quote.price <= 0) return null;
  const finite = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : null);
  return {
    price: quote.price,
    change: finite(quote.change),
    changePercent: finite(quote.changePercent),
    currency: quote.currency || "INR",
    asOf: quote.lastUpdated ?? null,
    source: quote.source || "Upstox",
  };
}

/**
 * Quotes for many symbols with one provider call for whatever isn't cached,
 * a short cache (every feed page shares it) and a time limit, so a slow
 * provider never holds up the feed.
 */
export function quoteCache(batch: QuoteBatch, now: () => number = Date.now, timeoutMs = QUOTE_TIMEOUT_MS) {
  const cache = new Map<string, { at: number; quote: StockQuote | null }>();

  return async function quotes(symbols: string[]): Promise<Map<string, StockQuote>> {
    const wanted = [...new Set(symbols)].slice(0, MAX_QUOTED);
    const fresh = (s: string) => {
      const hit = cache.get(s);
      return hit && now() - hit.at < QUOTE_TTL_MS ? hit : null;
    };
    const missing = wanted.filter((s) => !fresh(s));

    if (missing.length) {
      const fetched = await Promise.race([
        batch(missing).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      // A failed or timed-out batch isn't cached, so the next page tries again.
      if (fetched) {
        const bySymbol = new Map(fetched.map((q) => [q.symbol.replace(/\.NS$/i, "").toUpperCase(), q]));
        for (const symbol of missing) cache.set(symbol, { at: now(), quote: toStockQuote(symbol, bySymbol.get(symbol)) });
      }
    }

    const result = new Map<string, StockQuote>();
    for (const symbol of wanted) {
      const quote = fresh(symbol)?.quote;
      if (quote) result.set(symbol, quote);
    }
    return result;
  };
}

/** "₹812.40", "+1.25%" and the tone to colour it, for the tag. Safe in the browser. */
export function formatQuote(quote: StockQuote): { price: string; change: string | null; tone: "up" | "down" | "flat"; title: string } {
  const price = new Intl.NumberFormat("en-IN", { style: "currency", currency: quote.currency || "INR", maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(quote.price);
  const pct = quote.changePercent;
  const tone = pct === null || Math.abs(pct) < 0.005 ? "flat" : pct > 0 ? "up" : "down";
  const change = pct === null ? null : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
  const when = quote.asOf ? ` · as of ${new Date(quote.asOf).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })} IST` : "";
  return { price, change, tone, title: `Last price from ${quote.source}${when}. Market data, not a member's opinion.` };
}
