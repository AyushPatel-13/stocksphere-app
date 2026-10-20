import { getFinnhubIndustry } from "../apis/finnhubIndustry";
import { NSE_INDEX_UNIVERSES, getNseConstituents, type ConstituentList, type NseIndexId } from "../apis/niftyIndices";
import { getUpstoxQuotes } from "../apis/upstox";
import { getYahooFundamentals, type YahooFundamentals } from "../apis/yahooFundamentals";
import { fromUpstox } from "../adapters/quote.adapter";
import { US_LARGE_CAPS } from "../analytics/screener";
import { priceGap } from "../analytics/heatmapMetrics";
import type { AssetQuote } from "../types/quote";
import { getHistory, resolveAsset, type History } from "./history";

/**
 * Everything one Heatmap view needs, for a whole universe in one request.
 *
 *   NSE indices   constituents, names, ISINs and sector from NSE Indices'
 *                 published lists; quotes from Upstox (one bulk call per
 *                 200 stocks, keyed by ISIN — no per-stock search)
 *   US large caps the app's own 20-stock list (lib/analytics/screener.ts);
 *                 quotes from the cached Yahoo 1-day chart; industry from
 *                 Finnhub's company profile
 *   Market cap    price × Yahoo shares outstanding, every universe
 *
 * Market caps for a large universe take a while on a cold cache (one Yahoo
 * call per stock, cached for 6 hours), so a response waits up to a time
 * budget and reports how many are still loading; the page asks again.
 * A figure a provider didn't send stays null — never estimated.
 */

export const UNIVERSES = [
  ...(Object.keys(NSE_INDEX_UNIVERSES) as NseIndexId[]).map((id) => ({ id, label: NSE_INDEX_UNIVERSES[id].label, market: "India" as const })),
  { id: "us" as const, label: "US large caps", market: "US" as const },
];

export type HeatmapUniverse = NseIndexId | "us";
export const HEATMAP_UNIVERSES: readonly HeatmapUniverse[] = UNIVERSES.map((u) => u.id);

export function isHeatmapUniverse(value: string): value is HeatmapUniverse {
  return (HEATMAP_UNIVERSES as readonly string[]).includes(value);
}

export type HeatmapTile = {
  symbol: string;
  /** What /stock/[symbol] should be opened with ("TCS.NS" for NSE). */
  href: string;
  name: string | null;
  market: "India" | "US";
  currency: string | null;
  sector: string | null;
  industry: string | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  previousClose: number | null;
  gap: number | null;
  volume: number | null;
  marketCap: number | null;
  /** As-of date of the shares-outstanding figure behind marketCap. */
  sharesAsOf: string | null;
  /** When the price was printed (ISO) when the source says; else null. */
  quoteTime: string | null;
};

export type Classification = { available: true; source: string } | { available: false; reason: string };

export type HeatmapData = {
  universe: HeatmapUniverse;
  label: string;
  market: "India" | "US";
  priceSource: string;
  capSource: string;
  constituentSource: string;
  /** When the prices were fetched (ISO). */
  fetchedAt: string;
  sector: Classification;
  industry: Classification;
  /** Priced stocks whose market cap is still being looked up. */
  capsPending: number;
  tiles: HeatmapTile[];
};

export interface HeatmapDeps {
  constituents: (id: NseIndexId) => Promise<ConstituentList | null>;
  /** Upstox quotes for NSE instrument keys ("NSE_EQ|<ISIN>"), keyed by instrument key. */
  upstoxQuotes: (instrumentKeys: string[]) => Promise<Map<string, AssetQuote>>;
  usHistory: (symbol: string) => Promise<History | null>;
  usIndustry: (symbol: string) => Promise<string | null>;
  fundamentals: (yahooSymbol: string) => Promise<YahooFundamentals | null>;
  now: () => number;
  /** How long a request waits for market caps before answering with some pending. */
  capBudgetMs: number;
}

const UPSTOX_CHUNK = 200;

async function defaultUpstoxQuotes(keys: string[]): Promise<Map<string, AssetQuote>> {
  const out = new Map<string, AssetQuote>();
  for (let i = 0; i < keys.length; i += UPSTOX_CHUNK) {
    const chunk = keys.slice(i, i + UPSTOX_CHUNK);
    const data = await getUpstoxQuotes(chunk).catch(() => null);
    if (!data) continue;
    for (const key of chunk) {
      try {
        out.set(key, fromUpstox(data, key));
      } catch {
        // No quote for this instrument: it stays unpriced.
      }
    }
  }
  return out;
}

const DEFAULT_DEPS: HeatmapDeps = {
  constituents: (id) => getNseConstituents(id),
  upstoxQuotes: defaultUpstoxQuotes,
  usHistory: (symbol) => {
    const asset = resolveAsset("stock", symbol);
    return asset ? getHistory(asset, "1d").catch(() => null) : Promise.resolve(null);
  },
  usIndustry: (symbol) => getFinnhubIndustry(symbol),
  fundamentals: (yahooSymbol) => getYahooFundamentals(yahooSymbol),
  now: Date.now,
  capBudgetMs: 6_000,
};

const finitePositive = (v: number | undefined | null): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

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

export function marketCapOf(price: number | null, fundamentals: YahooFundamentals | null): { marketCap: number | null; sharesAsOf: string | null } {
  const shares = fundamentals?.sharesOutstanding;
  if (price === null || price <= 0 || !shares) return { marketCap: null, sharesAsOf: null };
  return { marketCap: Math.round(price * shares.value), sharesAsOf: shares.asOf };
}

/* ------------------------------------------------------------ market caps */

const CAP_CONCURRENCY = 8;
const CAP_MISS_TTL_MS = 10 * 60_000;

type CapState = { done: true; value: YahooFundamentals | null; at: number } | { done: false; promise: Promise<void> };
const capStates = new Map<string, CapState>();
let capActive = 0;
const capQueue: (() => void)[] = [];

async function withCapSlot<T>(task: () => Promise<T>): Promise<T> {
  if (capActive >= CAP_CONCURRENCY) await new Promise<void>((resolve) => capQueue.push(resolve));
  capActive++;
  try {
    return await task();
  } finally {
    capActive--;
    capQueue.shift()?.();
  }
}

/**
 * Start (or reuse) the shares lookup for a symbol. Lookups keep running after
 * a request's budget runs out, so the next request finds them done. A miss is
 * remembered for 10 minutes so polling doesn't hammer the provider.
 */
function capLookup(yahooSymbol: string, deps: HeatmapDeps): CapState {
  const state = capStates.get(yahooSymbol);
  if (state && (!state.done || state.value !== null || deps.now() - state.at < CAP_MISS_TTL_MS)) return state;
  const promise = withCapSlot(() => deps.fundamentals(yahooSymbol))
    .catch(() => null)
    .then((value) => {
      capStates.set(yahooSymbol, { done: true, value, at: deps.now() });
    });
  const pending: CapState = { done: false, promise };
  capStates.set(yahooSymbol, pending);
  return pending;
}

async function resolveCaps(yahooSymbols: string[], deps: HeatmapDeps): Promise<Map<string, YahooFundamentals | null | "pending">> {
  const states = yahooSymbols.map((s) => capLookup(s, deps));
  const waiting = states.flatMap((s) => (s.done ? [] : [s.promise]));
  if (waiting.length > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(waiting),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, deps.capBudgetMs);
      }),
    ]);
    clearTimeout(timer);
  }
  const out = new Map<string, YahooFundamentals | null | "pending">();
  for (const s of yahooSymbols) {
    const state = capStates.get(s);
    out.set(s, state?.done ? state.value : "pending");
  }
  return out;
}

/** Test hook: forget cached answers and cap lookups. */
export function clearHeatmapCache() {
  cache.clear();
  capStates.clear();
}

/* ------------------------------------------------------------ build */

/** Null when the universe's constituents or every price is unavailable. */
export async function buildHeatmap(universe: HeatmapUniverse, deps: HeatmapDeps = DEFAULT_DEPS): Promise<HeatmapData | null> {
  const fetchedAt = new Date(deps.now()).toISOString();

  if (universe !== "us") {
    const list = await deps.constituents(universe);
    if (!list) return null;
    const keys = list.constituents.map((c) => `NSE_EQ|${c.isin}`);
    const quotes = await deps.upstoxQuotes(keys);
    if (quotes.size === 0) return null;

    const priced = list.constituents.map((c, i) => {
      const q = quotes.get(keys[i]);
      const price = finitePositive(q?.price);
      const previousClose = price !== null ? finitePositive(q?.previousClose) : null;
      const change = price !== null && previousClose !== null ? price - previousClose : null;
      return { c, q, price, previousClose, change };
    });
    const caps = await resolveCaps(priced.filter((p) => p.price !== null).map((p) => `${p.c.symbol}.NS`), deps);

    let capsPending = 0;
    const tiles = priced.map(({ c, q, price, previousClose, change }): HeatmapTile => {
      const cap = price !== null ? caps.get(`${c.symbol}.NS`) : null;
      if (cap === "pending") capsPending++;
      const open = price !== null ? finitePositive(q?.open) : null;
      return {
        symbol: c.symbol,
        href: `${c.symbol}.NS`,
        name: c.name,
        market: "India",
        currency: "INR",
        sector: c.sector,
        industry: null,
        price,
        change,
        changePercent: change !== null && previousClose !== null ? (change / previousClose) * 100 : null,
        open,
        previousClose,
        gap: priceGap(open, previousClose),
        volume: price !== null && typeof q?.volume === "number" && Number.isFinite(q.volume) && q.volume >= 0 ? q.volume : null,
        ...marketCapOf(price, cap === "pending" || cap === undefined ? null : cap),
        quoteTime: null,
      };
    });

    const hasSector = tiles.some((t) => t.sector !== null);
    return {
      universe,
      label: NSE_INDEX_UNIVERSES[universe].label,
      market: "India",
      priceSource: "Upstox",
      capSource: "Price × shares outstanding (Yahoo)",
      constituentSource: `${list.source}, fetched ${list.fetchedAt.slice(0, 10)}`,
      fetchedAt,
      sector: hasSector ? { available: true, source: "NSE sector classification (index constituent list)" } : { available: false, reason: "The NSE list didn't include a classification." },
      industry: { available: false, reason: "NSE's constituent lists carry one classification level (sector); finer industry levels aren't published there." },
      capsPending,
      tiles,
    };
  }

  const symbols = [...US_LARGE_CAPS];
  const [histories, industries] = await Promise.all([mapLimit(symbols, 6, (s) => deps.usHistory(s)), mapLimit(symbols, 4, (s) => deps.usIndustry(s).catch(() => null))]);
  if (histories.every((h) => !h || h.candles.length === 0)) return null;

  const priced = symbols.map((symbol, i) => {
    const h = histories[i];
    const last = h?.candles[h.candles.length - 1];
    const price = finitePositive(last?.c);
    const previousClose = price !== null ? finitePositive(h?.previousClose) : null;
    return { symbol, h, price, previousClose };
  });
  const caps = await resolveCaps(priced.filter((p) => p.price !== null).map((p) => p.symbol), deps);

  let capsPending = 0;
  const tiles = priced.map(({ symbol, h, price, previousClose }, i): HeatmapTile => {
    const cap = price !== null ? caps.get(symbol) : null;
    if (cap === "pending") capsPending++;
    const change = price !== null && previousClose !== null ? price - previousClose : null;
    const open = price !== null ? finitePositive(h?.candles[0]?.o) : null;
    const volumes = (h?.candles ?? []).map((c) => c.v).filter((v): v is number => typeof v === "number" && v >= 0);
    return {
      symbol,
      href: symbol,
      name: h?.name ?? null,
      market: "US",
      currency: h?.currency ?? "USD",
      sector: null,
      industry: industries[i],
      price,
      change,
      changePercent: change !== null && previousClose !== null ? (change / previousClose) * 100 : null,
      open,
      previousClose,
      gap: priceGap(open, previousClose),
      volume: price !== null && volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) : null,
      ...marketCapOf(price, cap === "pending" || cap === undefined ? null : cap),
      quoteTime: price !== null ? h?.marketTime ?? null : null,
    };
  });

  return {
    universe,
    label: "US large caps",
    market: "US",
    priceSource: "Yahoo",
    capSource: "Price × shares outstanding (Yahoo)",
    constituentSource: "StockSphere's 20-stock US large-cap list",
    fetchedAt,
    sector: { available: false, reason: "Our US source (Finnhub) provides a single industry classification, not a separate sector." },
    industry: tiles.some((t) => t.industry !== null) ? { available: true, source: "Finnhub company profile" } : { available: false, reason: "Finnhub didn't return industries right now." },
    capsPending,
    tiles,
  };
}

/* ------------------------------------------------------------ cache */

const CACHE_TTL_MS = 30_000;
const cache = new Map<HeatmapUniverse, { at: number; data: HeatmapData }>();
const inFlight = new Map<HeatmapUniverse, Promise<HeatmapData | null>>();

/**
 * buildHeatmap reused for 30 seconds per universe once every market cap has
 * settled, with concurrent requests sharing one load. Unavailable or
 * still-loading answers are not cached.
 */
export async function getHeatmap(universe: HeatmapUniverse, deps: HeatmapDeps = DEFAULT_DEPS): Promise<HeatmapData | null> {
  const hit = cache.get(universe);
  if (hit && deps.now() - hit.at < CACHE_TTL_MS) return hit.data;

  let pending = inFlight.get(universe);
  if (!pending) {
    pending = buildHeatmap(universe, deps)
      .then((data) => {
        if (data && data.capsPending === 0) cache.set(universe, { at: deps.now(), data });
        return data;
      })
      .finally(() => inFlight.delete(universe));
    inFlight.set(universe, pending);
  }
  return pending;
}
