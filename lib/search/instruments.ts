import { searchFinnhubSymbols, type FinnhubSymbolMatch } from "../apis/finnhub";
import { searchUpstoxEquityCandidates, type UpstoxEquityCandidate } from "../apis/upstox";
import { BONDS, CRYPTO, ETFS } from "../data/assets";
import { GLOBAL_INDICES, INDIAN_INDICES } from "../data/instruments/indices";
import { isIndianEquitySymbol } from "../data/instruments/india";
import { stocks } from "../stocks";
import { companyNameTokens, matchTier } from "./rank";

/**
 * Instrument search for the search box: one ranked list across
 *
 *   - StockSphere's own instrument lists (instant, no network): indices, ETFs,
 *     crypto, bonds and the known-stocks list;
 *   - Upstox's NSE instrument search (Indian stocks and ETFs);
 *   - Finnhub's symbol search (US stocks and ETFs).
 *
 * Every result links to a page that exists for it, by its canonical id.
 * Each remote source fails on its own: a search with Upstox down still returns
 * the local and US matches.
 */

export type InstrumentType = "stock" | "etf" | "index" | "crypto" | "bond";

export type SearchResult = {
  /** Stable key: market + symbol. */
  id: string;
  symbol: string;
  name: string;
  type: InstrumentType;
  /** Exchange or venue shown to the user: NSE, BSE, US, Crypto… */
  exchange: string;
  market: "India" | "US" | "Global";
  href: string;
};

export type SearchResponse = {
  query: string;
  results: SearchResult[];
  /** True when a remote source failed, so results may be incomplete. */
  partial: boolean;
};

export const MIN_REMOTE_QUERY = 2;
export const MAX_QUERY_LENGTH = 40;
export const DEFAULT_LIMIT = 8;
export const MAX_LIMIT = 15;

const QUERY_PATTERN = /^[A-Za-z0-9 &.\-']+$/;

/** Trimmed, single-spaced query, or null when it can't be a search term. */
export function normaliseQuery(raw: string | null | undefined): string | null {
  const query = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!query || query.length > MAX_QUERY_LENGTH || !QUERY_PATTERN.test(query)) return null;
  return query;
}

/* ------------------------------------------------------------ canonical links */

/**
 * An Indian stock outside StockSphere's known universe must carry ".NS": a
 * bare "/stock/RPOWER" would be routed to the global providers, which may
 * hold a different security under that ticker.
 */
export function indianStockHref(symbol: string): string {
  const bare = symbol.toUpperCase();
  return `/stock/${encodeURIComponent(isIndianEquitySymbol(bare) ? bare : `${bare}.NS`)}`;
}

const ETF_BY_SYMBOL = new Map(ETFS.map((etf) => [etf.symbol, etf]));

/* ------------------------------------------------------------ local sources */

type Candidate = SearchResult & { aliases?: string[] };

const INDEX_ALIASES: Record<string, string[]> = {
  NIFTY: ["nifty 50", "nifty50"],
  BANKNIFTY: ["bank nifty"],
  NIFTYNEXT50: ["nifty next 50", "junior nifty"],
  SPX: ["s&p 500", "sp500", "s&p"],
  DOW: ["dow jones", "djia"],
  NASDAQ100: ["nasdaq", "nasdaq 100"],
  NIKKEI: ["nikkei 225"],
  HANGSENG: ["hang seng", "hsi"],
  FTSE: ["ftse 100"],
  CAC40: ["cac 40", "cac"],
};

function localCatalog(): Candidate[] {
  const indices: Candidate[] = [...INDIAN_INDICES, ...GLOBAL_INDICES].map((index) => ({
    id: `index:${index.symbol}`,
    symbol: index.symbol,
    name: index.name,
    type: "index",
    exchange: index.category === "indian" ? (index.symbol === "SENSEX" ? "BSE" : "NSE") : "Index",
    market: index.category === "indian" ? "India" : "Global",
    href: `/asset/index/${index.symbol}`,
    aliases: INDEX_ALIASES[index.symbol],
  }));

  const etfs: Candidate[] = ETFS.map((etf) => ({
    id: `${etf.region === "india" ? "India" : "US"}:${etf.symbol}`,
    symbol: etf.symbol,
    name: etf.name,
    type: "etf",
    exchange: etf.region === "india" ? "NSE" : "US",
    market: etf.region === "india" ? "India" : "US",
    href: `/asset/etf/${etf.symbol}`,
  }));

  const crypto: Candidate[] = CRYPTO.map((coin) => ({
    id: `crypto:${coin.symbol}`,
    symbol: coin.symbol,
    name: coin.name,
    type: "crypto",
    exchange: "Crypto",
    market: "Global",
    href: `/asset/crypto/${coin.symbol}`,
  }));

  const bonds: Candidate[] = BONDS.map((bond) => ({
    id: `bond:${bond.symbol}`,
    symbol: bond.symbol,
    name: bond.name,
    type: "bond",
    exchange: bond.region === "india" ? "NSE" : "US Treasury",
    market: bond.region === "india" ? "India" : "US",
    href: `/asset/bond/${bond.symbol}`,
  }));

  const known: Candidate[] = stocks.map((stock) => {
    const indian = isIndianEquitySymbol(stock.symbol);
    return {
      id: `${indian ? "India" : "US"}:${stock.symbol}`,
      symbol: stock.symbol,
      name: stock.name,
      type: "stock",
      exchange: indian ? "NSE" : "US",
      market: indian ? "India" : "US",
      href: indian ? indianStockHref(stock.symbol) : `/stock/${stock.symbol}`,
    };
  });

  return [...indices, ...etfs, ...crypto, ...bonds, ...known];
}

const LOCAL = localCatalog();

/* ------------------------------------------------------------ remote sources */

export function fromUpstox(rows: UpstoxEquityCandidate[]): Candidate[] {
  return rows.map((row) => {
    const symbol = row.trading_symbol.toUpperCase();
    const name = row.name?.trim() || row.short_name?.trim() || symbol;
    const listed = ETF_BY_SYMBOL.get(symbol);
    // Indian ETFs: "…ETF…", Nippon's "…BEES", or a fund-house prefix such as
    // "TATAAML-TATAGOLD" / "EDELAMC - EBBETF0430".
    const looksLikeEtf = Boolean(listed) || /ETF|BEES\b|AML-|AMC\s*-/i.test(`${name} ${symbol}`);

    return {
      id: `India:${symbol}`,
      symbol,
      name,
      type: looksLikeEtf ? "etf" : "stock",
      exchange: "NSE",
      market: "India",
      href: listed ? `/asset/etf/${symbol}` : indianStockHref(symbol),
    };
  });
}

export function fromFinnhub(rows: FinnhubSymbolMatch[]): Candidate[] {
  return rows.map((row) => {
    const listed = ETF_BY_SYMBOL.get(row.symbol);
    return {
      id: `US:${row.symbol}`,
      symbol: row.symbol,
      name: row.description || row.symbol,
      type: row.type === "ETP" || listed ? "etf" : "stock",
      exchange: "US",
      market: "US",
      href: listed ? `/asset/etf/${row.symbol}` : `/stock/${encodeURIComponent(row.symbol)}`,
    };
  });
}

/* ------------------------------------------------------------ ranking */

function bestTier(candidate: Candidate, lowerQuery: string, queryTokens: string[]): number {
  const names = [candidate.name, ...(candidate.aliases ?? [])];
  return Math.min(...names.map((name) => matchTier(candidate.symbol, name, lowerQuery, queryTokens)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A candidate matches when the ticker contains what was typed, or a word of
 * its name (or an alias) starts with it. Mid-word hits don't count: "spy" in
 * "Krispy Kreme" or "apple" in "Pineapple" aren't what anyone meant.
 */
function matches(candidate: Candidate, lowerQuery: string): boolean {
  if (candidate.symbol.toLowerCase().includes(lowerQuery)) return true;
  const atWordStart = new RegExp(`(^|[^a-z0-9])${escapeRegExp(lowerQuery)}`);
  return [candidate.name, ...(candidate.aliases ?? [])].some((text) => atWordStart.test(text.toLowerCase()));
}

/**
 * Merge sources (earlier sources win a duplicate: our own pages before remote
 * listings), then order by match strength — exact ticker, ticker prefix, exact
 * name, name prefix, contains — keeping source order within a tier.
 */
export function rankResults(sources: Candidate[][], query: string, limit: number): SearchResult[] {
  const lowerQuery = query.toLowerCase().replace(/\.(ns|bse|bo)$/, "");
  const queryTokens = companyNameTokens(lowerQuery);
  const seen = new Map<string, Candidate>();

  for (const candidate of sources.flat()) {
    if (!seen.has(candidate.id)) seen.set(candidate.id, candidate);
  }

  return [...seen.values()]
    .map((candidate, index) => ({ candidate, index, tier: bestTier(candidate, lowerQuery, queryTokens) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .slice(0, limit)
    .map(({ candidate }) => {
      const { aliases: _aliases, ...result } = candidate;
      void _aliases;
      return result;
    });
}

/* ------------------------------------------------------------ search */

export interface SearchDeps {
  searchIndian: (query: string, limit?: number) => Promise<UpstoxEquityCandidate[] | null>;
  searchUs: (query: string, limit?: number) => Promise<FinnhubSymbolMatch[] | null>;
  now: () => number;
}

const DEFAULT_DEPS: SearchDeps = {
  searchIndian: searchUpstoxEquityCandidates,
  searchUs: searchFinnhubSymbols,
  now: Date.now,
};

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 500;

export function createInstrumentSearch(deps: SearchDeps = DEFAULT_DEPS) {
  const cache = new Map<string, { at: number; response: SearchResponse }>();

  return async function searchInstruments(query: string, limit: number = DEFAULT_LIMIT): Promise<SearchResponse> {
    const capped = Math.min(Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const key = `${query.toLowerCase()}|${capped}`;
    const hit = cache.get(key);
    if (hit && deps.now() - hit.at < CACHE_TTL_MS) return hit.response;

    const lowerQuery = query.toLowerCase().replace(/\.(ns|bse|bo)$/, "");
    const local = LOCAL.filter((candidate) => matches(candidate, lowerQuery));

    let partial = false;
    let indian: Candidate[] = [];
    let us: Candidate[] = [];

    if (lowerQuery.length >= MIN_REMOTE_QUERY) {
      const bare = query.replace(/\.(NS|BSE|BO)$/i, "");
      const [indianRows, usRows] = await Promise.all([
        deps.searchIndian(bare, 15).catch(() => null),
        deps.searchUs(bare, 10).catch(() => null),
      ]);

      // Providers sometimes return loose matches (Finnhub answers "spy" with
      // unrelated tickers); a result must actually contain what was typed.
      if (indianRows) indian = fromUpstox(indianRows).filter((c) => matches(c, lowerQuery));
      else partial = true;
      if (usRows) us = fromFinnhub(usRows).filter((c) => matches(c, lowerQuery));
      else partial = true;
    }

    const response: SearchResponse = {
      query,
      results: rankResults([local, indian, us], query, capped),
      partial,
    };

    // An incomplete answer is not kept, so the next keystroke retries the source.
    if (!partial) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(key, { at: deps.now(), response });
    }

    return response;
  };
}

export const searchInstruments = createInstrumentSearch();
