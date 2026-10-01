import type { AssetQuote } from "@/lib/types/quote";
import { NIFTY_50_SYMBOLS } from "@/lib/data/instruments/india";
import { getNifty50Quotes } from "@/lib/providers/market.provider";

/**
 * Nifty 50 breadth and the top movers each way.
 *
 * This is the single place the ranking is computed. It used to live inside
 * app/api/market/movers/route.ts, which meant anything else wanting a ranked
 * list — the Agent's market-movers tool, today — would have had to recompute
 * it, and the panel and the assistant could have disagreed about what the top
 * gainers were. A route file may only export the names Next.js allows, so the
 * computation could not simply be exported from there.
 *
 * The universe is NIFTY_50_SYMBOLS, whose quotes come from the same provider
 * the route has always used (getNifty50Quotes → getIndianMarketQuotes →
 * Upstox). Nothing new is fetched and no second provider is introduced.
 */

/**
 * The wire value. The Home page reads this exact string, so it is part of the
 * /api/market/movers response contract.
 */
export const MARKET_MOVERS_UNIVERSE = "NIFTY_50";

/**
 * The same universe as a sentence a person (or the Agent) can use. Kept beside
 * the wire value so "which index are these rankings from?" has one answer.
 */
export const MARKET_MOVERS_UNIVERSE_LABEL = "Nifty 50 (NSE, India)";

/** How many movers each side the Home page's breadth panel shows. */
export const HOME_MOVERS_PER_SIDE = 3;

export type MarketDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface MarketMoversSummary {
  universe: typeof MARKET_MOVERS_UNIVERSE;
  totalStocks: number;
  advancing: number;
  declining: number;
  unchanged: number;
  direction: MarketDirection;
  breadthPercent: number;
  gainers: AssetQuote[];
  losers: AssetQuote[];
}

/** Signature of the Nifty 50 quote loader (injectable for tests). */
export type MarketQuotesLookup = () => Promise<AssetQuote[]>;

/**
 * Derive the breadth and ranked movers from a set of quotes.
 *
 * Pure, so the route and the Agent tool cannot drift: given the same quotes
 * and the same `moversPerSide` they produce byte-identical rankings.
 *
 * `moversPerSide` is clamped rather than trusted. A negative value would reach
 * Array.prototype.slice as a negative index — which counts back from the end
 * instead of returning nothing — so the bound is enforced here rather than
 * assumed of every caller.
 */
export function summariseMarketMovers(
  quotes: AssetQuote[],
  moversPerSide: number = HOME_MOVERS_PER_SIDE
): MarketMoversSummary {
  const perSide = Number.isFinite(moversPerSide)
    ? Math.max(0, Math.floor(moversPerSide))
    : HOME_MOVERS_PER_SIDE;

  const advancing = quotes.filter((quote) => (quote.changePercent ?? 0) > 0);
  const declining = quotes.filter((quote) => (quote.changePercent ?? 0) < 0);
  const unchanged = quotes.filter((quote) => (quote.changePercent ?? 0) === 0);

  const totalStocks = quotes.length;

  const breadthPercent =
    totalStocks > 0 ? (advancing.length / totalStocks) * 100 : 0;

  let direction: MarketDirection;

  if (advancing.length > declining.length) {
    direction = "BULLISH";
  } else if (declining.length > advancing.length) {
    direction = "BEARISH";
  } else {
    direction = "NEUTRAL";
  }

  const gainers = [...advancing]
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))
    .slice(0, perSide);

  const losers = [...declining]
    .sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0))
    .slice(0, perSide);

  return {
    universe: MARKET_MOVERS_UNIVERSE,
    totalStocks,
    advancing: advancing.length,
    declining: declining.length,
    unchanged: unchanged.length,
    direction,
    breadthPercent,
    gainers,
    losers,
  };
}

/**
 * Load the Nifty 50 quotes and summarise them, or report "unavailable".
 *
 * getNifty50Quotes() reports "Upstox could not be reached", "Upstox answered
 * with an error" and "the payload held nothing normalisable" the same way — as
 * an empty array. The universe it asks about is a static, non-empty list, so an
 * empty answer for a non-empty universe is a provider failure, and `null` is
 * how that is returned to both callers. Callers must not turn it into an empty
 * ranking: "no stocks moved today" and "we could not find out" are different
 * facts, and only the first is ever true when the provider answered.
 *
 * An empty *universe* is the one legitimately empty case: there is then nothing
 * to ask for, so the original success-with-zeroes contract is preserved rather
 * than inventing a failure for it. It is unreachable while NIFTY_50_SYMBOLS is
 * a non-empty constant.
 *
 * Errors are deliberately not caught here — the route maps a thrown error to
 * its own 500, and a tool caller decides for itself what a throw means.
 */
export async function loadMarketMovers(
  loadQuotes: MarketQuotesLookup = getNifty50Quotes,
  moversPerSide: number = HOME_MOVERS_PER_SIDE
): Promise<MarketMoversSummary | null> {
  const quotes = await loadQuotes();

  if (quotes.length === 0 && NIFTY_50_SYMBOLS.length > 0) {
    return null;
  }

  // The depth is asked for here rather than trimmed by the caller afterwards:
  // summarising at the panel's three and slicing to five returns three, which
  // is exactly how a "top 5 stocks today" would have quietly become a top 3.
  return summariseMarketMovers(quotes, moversPerSide);
}
