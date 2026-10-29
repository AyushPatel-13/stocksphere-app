import { searchFinnhubSymbols, type FinnhubSymbolMatch } from "../apis/finnhub";
import { searchUpstoxEquityCandidates, type UpstoxEquityCandidate } from "../apis/upstox";
import { BONDS, CRYPTO, ETFS } from "../data/assets";
import { COMMODITIES } from "../data/commodities";
import { GLOBAL_INDICES, INDIAN_INDICES } from "../data/instruments/indices";
import { isIndianEquitySymbol } from "../data/instruments/india";
import { stocks } from "../stocks";
import { indianStockHref } from "./canonical";
import { companyNameTokens, matchTier } from "./rank";
import { RETIRED_LISTINGS, isRetiredSymbol } from "./renames";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_QUERY_LENGTH,
  matchesFilters,
  parseQuery,
  type InstrumentType,
  type SearchFilters,
  type SearchResponse,
  type SearchResult,
} from "./types";

/**
 * The one instrument search every search field in StockSphere uses (through
 * /api/search and components/Search/SearchBox.tsx). One ranked list across
 *
 *   - StockSphere's own instrument lists (instant, no network): indices, ETFs,
 *     crypto, bonds, MCX commodities and the known-stocks list;
 *   - Upstox's NSE instrument search (Indian stocks and ETFs);
 *   - Finnhub's symbol search (US stocks and ETFs).
 *
 * Nothing is invented: every result is a row from one of those lists or
 * providers, and links to a page that exists for it, by its canonical id.
 * Discovery is separate from quotes: a result can be found while its price is
 * unavailable. Each remote source fails (or times out) on its own: a search
 * with Upstox down still returns the local and US matches, marked partial.
 *
 * Not covered: BSE-only listings (Upstox is asked for NSE), non-US foreign
 * listings, F&O and commodity contracts by expiry, and mutual funds.
 */

export type { InstrumentType, SearchFilters, SearchResponse, SearchResult } from "./types";
export { DEFAULT_LIMIT, MAX_LIMIT, MAX_QUERY_LENGTH } from "./types";

export const MIN_REMOTE_QUERY = 2;
export const PROVIDER_TIMEOUT_MS = 5_000;

/**
 * Trimmed, single-spaced search text, or null when nothing searchable is left.
 * Kept for callers that only want the text; parseQuery also returns the
 * exchange a query names ("NSE:SBIN").
 */
export function normaliseQuery(raw: string | null | undefined): string | null {
  return parseQuery(raw)?.text ?? null;
}

/* ------------------------------------------------------------ canonical links */

// Canonical links live in ./canonical so the browser can use them too.
export { indianStockHref };

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
    currency: null,
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
    currency: etf.currency,
    href: `/asset/etf/${etf.symbol}`,
  }));

  const crypto: Candidate[] = CRYPTO.map((coin) => ({
    id: `crypto:${coin.symbol}`,
    symbol: coin.symbol,
    name: coin.name,
    type: "crypto",
    exchange: "Crypto",
    market: "Global",
    currency: "USD",
    href: `/asset/crypto/${coin.symbol}`,
  }));

  const bonds: Candidate[] = BONDS.map((bond) => ({
    id: `bond:${bond.symbol}`,
    symbol: bond.symbol,
    name: bond.name,
    type: "bond",
    exchange: bond.region === "india" ? "NSE" : "US Treasury",
    market: bond.region === "india" ? "India" : "US",
    currency: null,
    href: `/asset/bond/${bond.symbol}`,
  }));

  // MCX futures by product; the page picks the live contract (expiry).
  const commodities: Candidate[] = COMMODITIES.map((product) => ({
    id: `commodity:${product.symbol}`,
    symbol: product.symbol,
    name: product.name,
    type: "commodity",
    exchange: product.exchange,
    market: "India",
    currency: "INR",
    href: `/commodities/${encodeURIComponent(product.symbol)}`,
    aliases: product.category !== product.name ? [product.category] : undefined,
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
      currency: indian ? "INR" : "USD",
      href: indian ? indianStockHref(stock.symbol) : `/stock/${stock.symbol}`,
    };
  });

  // What renamed or demerged companies trade as now, found by their old name
  // or ticker too ("Zomato" → ETERNAL, "Tata Motors" → TMPV and TMCV).
  const successors: Candidate[] = RETIRED_LISTINGS.flatMap((listing) =>
    listing.successors.map((successor) => ({
      id: `India:${successor.symbol}`,
      symbol: successor.symbol,
      name: successor.name,
      type: "stock" as const,
      exchange: "NSE",
      market: "India" as const,
      currency: "INR",
      href: indianStockHref(successor.symbol),
      aliases: [...listing.formerNames, listing.symbol.toLowerCase()],
    }))
  );

  return [...indices, ...etfs, ...crypto, ...bonds, ...commodities, ...successors, ...known];
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
      currency: "INR",
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
      currency: "USD",
      href: listed ? `/asset/etf/${row.symbol}` : `/stock/${encodeURIComponent(row.symbol)}`,
    };
  });
}

/* ------------------------------------------------------------ ranking */

// Words initials skip: "State Bank of India" is SBI, not SBOI.
const INITIALS_SKIP = new Set(["of", "and", "the", "for"]);
const LEGAL_FORMS = new Set(["ltd", "limited", "inc", "corp", "co", "plc"]);

/**
 * The initials a name is known by, with and without its legal form:
 * "State Bank of India" → ["sbi"], "Hindustan Unilever Ltd" → ["hu", "hul"].
 * Only names of two or more words have initials; a one-word name's first
 * letter would match anything.
 */
export function nameInitials(name: string): string[] {
  const all = name.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word && !INITIALS_SKIP.has(word));
  const core = companyNameTokens(all.join(" "));
  const variants = new Set<string>();
  if (core.length >= 2) variants.add(core.map((word) => word[0]).join(""));
  if (all.length >= 2 && all.some((word) => LEGAL_FORMS.has(word))) variants.add(all.map((word) => word[0]).join(""));
  return [...variants];
}

/** A single word of three to six letters can be initials ("sbi", "hul"); shorter ones are too ambiguous. */
function initialsQuery(lowerQuery: string): string | null {
  return /^[a-z]{3,6}$/.test(lowerQuery) ? lowerQuery : null;
}

function bestTier(candidate: Candidate, lowerQuery: string, queryTokens: string[]): number {
  const names = [candidate.name, ...(candidate.aliases ?? [])];
  const tier = Math.min(...names.map((name) => matchTier(candidate.symbol, name, lowerQuery, queryTokens)));
  // Initials rank with a name-prefix match: as strong as typing the first word.
  const initials = initialsQuery(lowerQuery);
  if (tier > 3 && initials && nameInitials(candidate.name).includes(initials)) return 3;
  return tier;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A candidate matches when the ticker contains what was typed, a word of its
 * name (or an alias) starts with it, or it is the name's initials. Mid-word
 * hits don't count: "spy" in "Krispy Kreme" or "apple" in "Pineapple" aren't
 * what anyone meant.
 */
function matches(candidate: Candidate, lowerQuery: string): boolean {
  if (candidate.symbol.toLowerCase().includes(lowerQuery)) return true;
  const atWordStart = new RegExp(`(^|[^a-z0-9])${escapeRegExp(lowerQuery)}`);
  if ([candidate.name, ...(candidate.aliases ?? [])].some((text) => atWordStart.test(text.toLowerCase()))) return true;
  const initials = initialsQuery(lowerQuery);
  return Boolean(initials && nameInitials(candidate.name).includes(initials));
}

/**
 * Merge sources (earlier sources win a duplicate: our own pages before remote
 * listings), then order by match strength — exact ticker, ticker prefix, exact
 * name, name prefix or initials, contains — keeping source order within a tier.
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
  /** How long a provider gets before its answer is treated as missing. */
  timeoutMs?: number;
}

const DEFAULT_DEPS: SearchDeps = {
  searchIndian: searchUpstoxEquityCandidates,
  searchUs: searchFinnhubSymbols,
  now: Date.now,
};

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 500;

/** The provider's answer, or null if it failed or took longer than `ms`. */
function withTimeout<T>(run: () => Promise<T | null>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  const answer = Promise.resolve()
    .then(run)
    .catch(() => null);
  return Promise.race([answer, timeout]).finally(() => clearTimeout(timer));
}

/** Whether a source holding only `types` in `market` on `exchanges` can satisfy the filters. */
function sourceAllowed(filters: SearchFilters, types: InstrumentType[], market: SearchResult["market"], exchanges: string[]): boolean {
  if (filters.types?.length && !filters.types.some((type) => types.includes(type))) return false;
  if (filters.market && filters.market !== market) return false;
  if (filters.exchange && !exchanges.includes(filters.exchange.toUpperCase())) return false;
  return true;
}

function cacheKey(query: string, limit: number, filters: SearchFilters): string {
  const types = [...(filters.types ?? [])].sort().join(",");
  return [query.toLowerCase(), limit, types, filters.market ?? "", filters.exchange?.toUpperCase() ?? ""].join("|");
}

export function createInstrumentSearch(deps: SearchDeps = DEFAULT_DEPS) {
  const cache = new Map<string, { at: number; response: SearchResponse }>();
  const timeoutMs = deps.timeoutMs ?? PROVIDER_TIMEOUT_MS;

  return async function searchInstruments(
    query: string,
    limit: number = DEFAULT_LIMIT,
    filters: SearchFilters = {}
  ): Promise<SearchResponse> {
    const capped = Math.min(Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const text = query.trim().slice(0, MAX_QUERY_LENGTH);
    const key = cacheKey(text, capped, filters);
    const hit = cache.get(key);
    if (hit && deps.now() - hit.at < CACHE_TTL_MS) return hit.response;

    const lowerQuery = text.toLowerCase().replace(/\.(ns|bse|bo)$/, "");
    // A symbol that no longer trades (TATAMOTORS, ZOMATO) is never offered: it
    // would open a page no provider can price. Its successors are, above.
    const keep = (candidate: Candidate) =>
      !(candidate.market === "India" && isRetiredSymbol(candidate.symbol)) &&
      matches(candidate, lowerQuery) &&
      matchesFilters(candidate, filters);
    const local = LOCAL.filter(keep);

    let partial = false;
    let indian: Candidate[] = [];
    let us: Candidate[] = [];

    if (lowerQuery.length >= MIN_REMOTE_QUERY) {
      const bare = text.replace(/\.(NS|BSE|BO)$/i, "");
      // Sources that can't hold anything the filters allow aren't asked.
      const askIndian = sourceAllowed(filters, ["stock", "etf"], "India", ["NSE", "BSE"]);
      const askUs = sourceAllowed(filters, ["stock", "etf"], "US", ["US"]);
      const [indianRows, usRows] = await Promise.all([
        askIndian ? withTimeout(() => deps.searchIndian(bare, 15), timeoutMs) : Promise.resolve([]),
        askUs ? withTimeout(() => deps.searchUs(bare, 10), timeoutMs) : Promise.resolve([]),
      ]);

      // Providers sometimes return loose matches (Finnhub answers "spy" with
      // unrelated tickers); a result must actually contain what was typed.
      if (indianRows) indian = fromUpstox(indianRows).filter(keep);
      else partial = true;
      if (usRows) us = fromFinnhub(usRows).filter(keep);
      else partial = true;
    }

    const response: SearchResponse = {
      query: text,
      results: rankResults([local, indian, us], text, capped),
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
