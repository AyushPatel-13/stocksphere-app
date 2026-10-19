import { getUpstoxQuotes } from "../apis/upstox";
import { getYahooChartQuotes } from "../apis/yahooChart";
import {
  GLOBAL_INDICES,
  INDIAN_INDICES,
  type GlobalMarketIndex,
  type IndianMarketIndex,
  type MarketIndex,
} from "../data/instruments/indices";

export type IndexSource = "Upstox" | "Yahoo";

export type LiveIndex = MarketIndex & {
  source: IndexSource;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  lastUpdated: string | null;
};

/**
 * One load of every tracked index.
 *
 * `unavailable` names each market whose provider gave us no price at all, so a
 * page can say "global data is unavailable" instead of showing a table of
 * dashes as if the market had simply not moved.
 */
export interface IndicesSnapshot {
  indices: LiveIndex[];
  unavailable: MarketIndex["category"][];
  fetchedAt: string;
}

/**
 * The two provider calls, injectable so tests need no token and no network —
 * the convention lib/providers/price.ts and market.provider.ts already follow.
 */
/**
 * A global index quote, as any global provider reports it. Every field may be
 * missing; `marketTime` is when the market last priced it.
 */
export type GlobalIndexQuote = {
  price?: number | null;
  change?: number | null;
  changePercent?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  previousClose?: number | null;
  marketTime?: string | null;
};

export interface IndicesDeps {
  getUpstoxQuotes: typeof getUpstoxQuotes;
  /** Keyed by Yahoo ticker; a ticker it couldn't price is absent; null = all failed. */
  getYahooQuotes: (
    symbols: string[]
  ) => Promise<Record<string, GlobalIndexQuote> | null>;
  now: () => number;
}

const DEFAULT_DEPS: IndicesDeps = {
  getUpstoxQuotes,
  // Yahoo's chart endpoint: its quote endpoint (yahoo-finance2) is
  // rate-limited per IP and refused every request here; see lib/apis/yahooChart.ts.
  getYahooQuotes: getYahooChartQuotes,
  now: Date.now,
};

/**
 * How long one snapshot is reused.
 *
 * Every visit to the home page and /indices asks for all sixteen indices, and
 * the providers bill (or rate-limit) per request. Thirty seconds keeps the
 * figures fresh enough for an overview while collapsing a burst of visitors
 * into one upstream call.
 */
export const INDICES_CACHE_TTL_MS = 30_000;

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Change percent from change and previous close.
 *
 * A missing change is not a zero change, so it yields null rather than 0%.
 */
function percentOf(
  change: number | null,
  previousClose: number | null
): number | null {
  if (change === null || previousClose === null || previousClose === 0) {
    return null;
  }

  return (change / previousClose) * 100;
}

function emptyQuote(index: MarketIndex, source: IndexSource): LiveIndex {
  return {
    ...index,
    source,
    price: null,
    change: null,
    changePercent: null,
    open: null,
    high: null,
    low: null,
    previousClose: null,
    lastUpdated: null,
  };
}

type UpstoxQuote = {
  instrument_token?: unknown;
  last_price?: unknown;
  net_change?: unknown;
  prev_close_price?: unknown;
  timestamp?: unknown;
  ohlc?: { open?: unknown; high?: unknown; low?: unknown };
};

/**
 * Map a raw Upstox quote response onto the Indian indices.
 *
 * Upstox keys its response by its own symbol string ("NSE_INDEX:Nifty 50"),
 * not by the instrument key requested ("NSE_INDEX|Nifty 50"), so each entry is
 * matched on instrument_token — the same lookup classifyUpstoxPrice() does.
 */
export function mapUpstoxIndices(
  raw: unknown,
  indices: IndianMarketIndex[]
): LiveIndex[] {
  const data =
    raw && typeof raw === "object"
      ? (raw as { data?: unknown }).data
      : undefined;

  const quotes =
    data && typeof data === "object"
      ? (Object.values(data) as (UpstoxQuote | undefined)[])
      : [];

  return indices.map((index) => {
    const quote = quotes.find(
      (entry) => entry?.instrument_token === index.instrumentKey
    );

    if (!quote) return emptyQuote(index, "Upstox");

    const price = toNumber(quote.last_price);
    const change = toNumber(quote.net_change);
    const previousClose =
      toNumber(quote.prev_close_price) ??
      (price !== null && change !== null ? price - change : null);

    return {
      ...index,
      source: "Upstox",
      price,
      change,
      changePercent: percentOf(change, previousClose),
      open: toNumber(quote.ohlc?.open),
      high: toNumber(quote.ohlc?.high),
      low: toNumber(quote.ohlc?.low),
      previousClose,
      lastUpdated:
        typeof quote.timestamp === "string" ? quote.timestamp : null,
    };
  });
}

async function loadIndianIndices(deps: IndicesDeps): Promise<LiveIndex[]> {
  try {
    const raw = await deps.getUpstoxQuotes(
      INDIAN_INDICES.map((index) => index.instrumentKey)
    );

    return mapUpstoxIndices(raw, INDIAN_INDICES);
  } catch (error) {
    // getUpstoxQuotes throws when the access token is missing. That is an
    // unavailable market, not a failed page.
    console.error("Indian indices unavailable:", error);

    return INDIAN_INDICES.map((index) => emptyQuote(index, "Upstox"));
  }
}

function mapYahooIndex(
  index: GlobalMarketIndex,
  quote: GlobalIndexQuote | undefined,
  fetchedAt: string
): LiveIndex {
  if (!quote) return emptyQuote(index, "Yahoo");

  const price = toNumber(quote.price);
  const change = toNumber(quote.change);
  const previousClose = toNumber(quote.previousClose);

  return {
    ...index,
    source: "Yahoo",
    price,
    change,
    changePercent:
      toNumber(quote.changePercent) ?? percentOf(change, previousClose),
    open: toNumber(quote.open),
    high: toNumber(quote.high),
    low: toNumber(quote.low),
    previousClose,
    // Yahoo's own market time when it gives one; otherwise the moment we
    // read the quote, which is the honest timestamp left.
    lastUpdated:
      price === null
        ? null
        : typeof quote.marketTime === "string"
          ? quote.marketTime
          : fetchedAt,
  };
}

/**
 * All global indices from Yahoo. Twelve Data's free plan does not carry index
 * symbols (verified: "available starting with the Pro or Venture plan"), so
 * there is no fallback: a refusal is reported as the market being unavailable.
 */
async function loadGlobalIndices(
  deps: IndicesDeps,
  fetchedAt: string
): Promise<LiveIndex[]> {
  try {
    const quotes = await deps.getYahooQuotes(
      GLOBAL_INDICES.map((index) => index.yahooSymbol)
    );

    return GLOBAL_INDICES.map((index) =>
      mapYahooIndex(index, quotes?.[index.yahooSymbol], fetchedAt)
    );
  } catch (error) {
    console.error("Global indices unavailable:", error);

    return GLOBAL_INDICES.map((index) => emptyQuote(index, "Yahoo"));
  }
}

function unavailableMarkets(
  indices: LiveIndex[]
): MarketIndex["category"][] {
  return (["indian", "global"] as const).filter((category) =>
    indices
      .filter((index) => index.category === category)
      .every((index) => index.price === null)
  );
}

/**
 * Build a cached loader for the index snapshot.
 *
 * Concurrent callers share one in-flight request, and a snapshot is reused for
 * `ttlMs`. A snapshot with no price anywhere is never cached, so an outage is
 * retried on the next request rather than pinned for the whole window.
 */
export function createIndicesLoader(
  deps: IndicesDeps = DEFAULT_DEPS,
  ttlMs: number = INDICES_CACHE_TTL_MS
): () => Promise<IndicesSnapshot> {
  let cached: { snapshot: IndicesSnapshot; at: number } | null = null;
  let inFlight: Promise<IndicesSnapshot> | null = null;

  async function load(): Promise<IndicesSnapshot> {
    const fetchedAt = new Date(deps.now()).toISOString();

    const [indian, global] = await Promise.all([
      loadIndianIndices(deps),
      loadGlobalIndices(deps, fetchedAt),
    ]);

    const indices = [...indian, ...global];

    return {
      indices,
      unavailable: unavailableMarkets(indices),
      fetchedAt,
    };
  }

  return async () => {
    if (cached && deps.now() - cached.at < ttlMs) {
      return cached.snapshot;
    }

    if (!inFlight) {
      inFlight = load()
        .then((snapshot) => {
          if (snapshot.unavailable.length < 2) {
            cached = { snapshot, at: deps.now() };
          }

          return snapshot;
        })
        .finally(() => {
          inFlight = null;
        });
    }

    return inFlight;
  };
}

/** The app-wide loader: real providers, one shared cache per server process. */
export const getLiveIndices = createIndicesLoader();
