/**
 * The shared instrument search's types and the small pure helpers both sides
 * use: the server engine (./instruments.ts, /api/search) and the browser
 * combobox (components/Search/SearchBox.tsx). No provider code here, so it is
 * safe to import from a client component.
 */

export type InstrumentType = "stock" | "etf" | "index" | "crypto" | "bond" | "commodity";

export const INSTRUMENT_TYPES: readonly InstrumentType[] = ["stock", "etf", "index", "crypto", "bond", "commodity"];

export type Market = "India" | "US" | "Global";

export const MARKETS: readonly Market[] = ["India", "US", "Global"];

export type SearchResult = {
  /** Stable key: market (or asset class) + symbol. */
  id: string;
  symbol: string;
  name: string;
  /** Asset class. */
  type: InstrumentType;
  /** Exchange or venue shown to the user: NSE, BSE, MCX, US, Crypto… */
  exchange: string;
  market: Market;
  /** Price currency, or null where the value isn't money (index points, yields). */
  currency: "INR" | "USD" | null;
  /** StockSphere's page for the instrument. Every result has one. */
  href: string;
};

export type SearchResponse = {
  query: string;
  results: SearchResult[];
  /** True when a remote source failed or timed out, so results may be incomplete. */
  partial: boolean;
};

export type SearchFilters = {
  types?: InstrumentType[];
  market?: Market;
  /** Exchange as shown on results, upper-cased: NSE, BSE, MCX, US… */
  exchange?: string;
};

export const MAX_QUERY_LENGTH = 40;
export const DEFAULT_LIMIT = 8;
export const MAX_LIMIT = 15;

/* ------------------------------------------------------------ query parsing */

// Prefixes people type in front of a ticker ("NSE:SBIN", "NASDAQ AAPL"), and
// the filter each one means. US listings come back as one "US" venue (Finnhub's
// search is asked for the US as a whole), so NASDAQ/NYSE narrow to the market.
const EXCHANGE_PREFIXES: Record<string, SearchFilters> = {
  NSE: { exchange: "NSE" },
  BSE: { exchange: "BSE" },
  MCX: { exchange: "MCX" },
  NASDAQ: { market: "US" },
  NYSE: { market: "US" },
  US: { market: "US" },
};

/**
 * What a typed query asks for: the search text plus any exchange it names.
 *
 * Punctuation a ticker or name never needs is treated as a space rather than
 * refused, so "sbi," or "(tcs)" still search; "&", ".", "-" and "'" stay
 * because real names and tickers use them (M&M, BAJAJ-AUTO, BRK.B, Dr. Reddy's).
 * Returns null when nothing searchable is left or it is too long.
 */
export function parseQuery(raw: string | null | undefined): { text: string; filters: SearchFilters } | null {
  let text = String(raw ?? "")
    .replace(/[^A-Za-z0-9 &.\-':]/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  let filters: SearchFilters = {};
  const prefixed = /^([A-Za-z]+)\s*:\s*(.+)$/.exec(text) ?? /^([A-Za-z]+) (\S+)$/.exec(text);
  if (prefixed && EXCHANGE_PREFIXES[prefixed[1].toUpperCase()]) {
    filters = { ...EXCHANGE_PREFIXES[prefixed[1].toUpperCase()] };
    text = prefixed[2];
  }

  // Exchange suffixes name the exchange too: SBIN.NS, SBIN.BO, RELIANCE.BSE.
  const suffix = /\.(NS|BO|BSE)$/i.exec(text);
  if (suffix) {
    filters.exchange ??= suffix[1].toUpperCase() === "NS" ? "NSE" : "BSE";
    text = text.slice(0, suffix.index);
  }

  text = text.replace(/:/g, " ").replace(/^[\s.\-']+|[\s.\-']+$/g, "").replace(/\s+/g, " ");
  if (!text || text.length > MAX_QUERY_LENGTH) return null;
  return { text, filters };
}

/**
 * NSE results whose page exists for both NSE and BSE listings still say NSE:
 * StockSphere searches NSE's instrument list only (see ./instruments.ts), so a
 * BSE filter can't be honoured for stocks and narrowing to it would hide the
 * one listing we do have. Indices really are split (SENSEX is BSE's).
 */
export function matchesFilters(result: SearchResult, filters: SearchFilters): boolean {
  if (filters.types?.length && !filters.types.includes(result.type)) return false;
  if (filters.market && result.market !== filters.market) return false;
  if (filters.exchange) {
    const exchange = filters.exchange.toUpperCase();
    if (result.exchange.toUpperCase() === exchange) return true;
    return exchange === "BSE" && result.market === "India" && (result.type === "stock" || result.type === "etf");
  }
  return true;
}

const EXCHANGES = new Set(["NSE", "BSE", "MCX", "US", "CRYPTO", "INDEX", "US TREASURY"]);

/** Filters from the URL over those the query named; null when one is unknown. */
export function parseFilters(params: URLSearchParams, fromQuery: SearchFilters): SearchFilters | null {
  const filters: SearchFilters = { ...fromQuery };

  const types = params.get("types");
  if (types) {
    const list = types.split(",").map((type) => type.trim().toLowerCase()).filter(Boolean);
    if (!list.every((type) => (INSTRUMENT_TYPES as readonly string[]).includes(type))) return null;
    filters.types = list as InstrumentType[];
  }

  const market = params.get("market");
  if (market) {
    const match = MARKETS.find((m) => m.toLowerCase() === market.trim().toLowerCase());
    if (!match) return null;
    filters.market = match as Market;
  }

  const exchange = params.get("exchange");
  if (exchange) {
    const upper = exchange.trim().toUpperCase();
    if (!EXCHANGES.has(upper)) return null;
    filters.exchange = upper;
  }

  return filters;
}

/* ------------------------------------------------------------ browser side */

/** The /api/search URL for a query and a field's filters. */
export function searchUrl(query: string, limit: number, filters: SearchFilters = {}): string {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (filters.types?.length) params.set("types", filters.types.join(","));
  if (filters.market) params.set("market", filters.market);
  if (filters.exchange) params.set("exchange", filters.exchange);
  return `/api/search?${params.toString()}`;
}

// The filters as one string, so the search box re-runs a search when their
// values change rather than whenever a caller passes a new array.
export function filterKeyOf(types?: InstrumentType[], market?: Market, exchange?: string): string {
  return [types?.join(",") ?? "", market ?? "", exchange ?? ""].join("|");
}

export function filtersFromKey(key: string): SearchFilters {
  const [types, market, exchange] = key.split("|");
  return {
    types: types ? (types.split(",") as InstrumentType[]) : undefined,
    market: (market || undefined) as Market | undefined,
    exchange: exchange || undefined,
  };
}

/* ------------------------------------------------------------ display */

const TYPE_NOUN: Record<InstrumentType, string> = {
  stock: "stock",
  etf: "ETF",
  index: "Index",
  crypto: "Crypto",
  bond: "Bond yield",
  commodity: "Commodity future",
};

/** "Indian stock", "US ETF", "Index", "Crypto"… — the asset class in words. */
export function assetLabel(result: Pick<SearchResult, "type" | "market">): string {
  if (result.type === "stock" || result.type === "etf") {
    const where = result.market === "India" ? "Indian" : result.market === "US" ? "US" : "Global";
    return `${where} ${TYPE_NOUN[result.type]}`;
  }
  return TYPE_NOUN[result.type];
}

/* ------------------------------------------------------------ combobox keys */

/**
 * Where the highlighted option moves for a key, or undefined when the key
 * doesn't move it. -1 means nothing highlighted. Wraps at both ends.
 */
export function nextActiveIndex(key: string, active: number, length: number): number | undefined {
  if (length === 0) return key === "ArrowDown" || key === "ArrowUp" ? -1 : undefined;
  if (key === "ArrowDown") return (active + 1) % length;
  if (key === "ArrowUp") return active <= 0 ? length - 1 : active - 1;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return undefined;
}
