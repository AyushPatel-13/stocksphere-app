import { getNseConstituents, type ConstituentList } from "../apis/niftyIndices";
import { getYahooFundamentals, type YahooFundamentals } from "../apis/yahooFundamentals";
import { US_LARGE_CAPS } from "../analytics/screener";
import { NIFTY_50_SYMBOLS } from "../data/instruments/india";

/**
 * What the screener needs beyond prices, for its whole universe in one
 * answer: each company's shares outstanding and last fiscal year's net income (Yahoo), and
 * for the NIFTY 50 its NSE sector. The browser turns these into market cap
 * (price × shares) and P/E (market cap ÷ net income) with the price it already shows, so
 * the figures always agree with the price beside them.
 *
 * A company whose fundamentals can't be fetched has nulls, never estimates.
 * Kept for six hours (fundamentals change quarterly); a wholly failed load
 * isn't kept.
 */

export type ScreenerFundamental = {
  /** NSE's sector; null for US stocks (no public classification here) or when NSE's list is unavailable. */
  sector: string | null;
  sharesOutstanding: number | null;
  /** Net income of the last reported fiscal year, when positive. */
  netIncomeFy: number | null;
};

export type ScreenerFundamentals = {
  bySymbol: Record<string, ScreenerFundamental>;
  sectors: string[];
  sectorSource: string | null;
  fetchedAt: string;
};

export interface ScreenerFundamentalsDeps {
  constituents: () => Promise<ConstituentList | null>;
  fundamentals: (yahooSymbol: string) => Promise<YahooFundamentals | null>;
  now: () => number;
}

const DEFAULT_DEPS: ScreenerFundamentalsDeps = {
  constituents: () => getNseConstituents("nifty50"),
  fundamentals: (symbol) => getYahooFundamentals(symbol),
  now: Date.now,
};

const CONCURRENCY = 6;
const CACHE_MS = 6 * 3_600_000;

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function buildScreenerFundamentals(deps: ScreenerFundamentalsDeps = DEFAULT_DEPS): Promise<ScreenerFundamentals | null> {
  const india = [...NIFTY_50_SYMBOLS].map((symbol) => ({ symbol: symbol.toUpperCase(), yahoo: `${symbol.toUpperCase().replace(/\.(NS|BSE)$/, "")}.NS` }));
  const us = US_LARGE_CAPS.map((symbol) => ({ symbol, yahoo: symbol }));
  const all = [...india, ...us];

  const [list, fundamentals] = await Promise.all([
    deps.constituents().catch(() => null),
    mapLimit(all, CONCURRENCY, (entry) => deps.fundamentals(entry.yahoo).catch(() => null)),
  ]);
  // Nothing at all came back: unavailable, rather than a table of blanks presented as an answer.
  if (!list && fundamentals.every((f) => f === null)) return null;

  const sectorOf = new Map((list?.constituents ?? []).map((c) => [c.symbol.toUpperCase(), c.sector]));
  const bySymbol: Record<string, ScreenerFundamental> = {};
  all.forEach((entry, i) => {
    const f = fundamentals[i];
    bySymbol[entry.symbol] = {
      sector: sectorOf.get(entry.symbol.replace(/\.(NS|BSE)$/, "")) ?? null,
      sharesOutstanding: f?.sharesOutstanding?.value ?? null,
      netIncomeFy: f?.netIncomeFy?.value ?? null,
    };
  });

  const sectors = [...new Set(Object.values(bySymbol).map((f) => f.sector).filter((s): s is string => Boolean(s)))].sort((a, b) => a.localeCompare(b));
  return {
    bySymbol,
    sectors,
    sectorSource: list ? `NSE sector classification (${list.source})` : null,
    fetchedAt: new Date(deps.now()).toISOString(),
  };
}

let cached: { at: number; value: ScreenerFundamentals } | null = null;
let inFlight: Promise<ScreenerFundamentals | null> | null = null;

export async function getScreenerFundamentals(): Promise<ScreenerFundamentals | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  inFlight ??= buildScreenerFundamentals()
    .then((value) => {
      if (value) cached = { at: Date.now(), value };
      return value ?? cached?.value ?? null;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
