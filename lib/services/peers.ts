import { NSE_INDEX_UNIVERSES, getNseConstituents, type Constituent, type ConstituentList, type NseIndexId } from "../apis/niftyIndices";
import { getYahooFundamentals, type YahooFundamentals } from "../apis/yahooFundamentals";
import { getYahooStatements, netMargin, type Statements } from "../apis/yahooStatements";
import { bareIndianSymbol } from "../data/instruments/india";
import { getHistory, resolveAsset, type History } from "./history";

/**
 * Peers for an Indian stock: other companies in the same NSE sector, from
 * the narrowest NIFTY index that holds the stock and enough of its sector
 * (NIFTY 50, then 100, 200, 500), closest in market value first. So a large
 * bank is set beside large banks, not beside every lender in the NIFTY 500.
 *
 * The sector is NSE's own classification from its index constituent lists.
 * Every figure is the same one the stock's own page shows: price and day
 * change from the chart history, market cap from Yahoo's share count, and P/E, revenue and
 * net margin from the last reported fiscal year.
 * A figure that can't be sourced is null. US stocks aren't covered: the only
 * US classification the site has can't be shown publicly.
 */

export type PeerRow = {
  symbol: string;
  name: string | null;
  isSelf: boolean;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  /** Market cap ÷ the last fiscal year's net income (a split or bonus can't distort it); null without a profit. */
  pe: number | null;
  /** Last reported fiscal year. */
  revenue: number | null;
  netMarginPct: number | null;
  fiscalYearEnd: string | null;
};

export type Peers = {
  symbol: string;
  sector: string;
  /** The index the peers were drawn from, e.g. "NIFTY 100". */
  universe: string;
  currency: "INR";
  rows: PeerRow[];
  sectorSource: string;
};

export interface PeerDeps {
  constituents: (id: NseIndexId) => Promise<ConstituentList | null>;
  history: (symbol: string) => Promise<History | null>;
  fundamentals: (symbol: string) => Promise<YahooFundamentals | null>;
  statements: (symbol: string) => Promise<Statements | null>;
}

const yahoo = (symbol: string) => `${symbol}.NS`;

const DEFAULT_DEPS: PeerDeps = {
  constituents: (id) => getNseConstituents(id),
  history: async (symbol) => {
    const asset = resolveAsset("stock", symbol);
    return asset ? getHistory(asset, "1d") : null;
  },
  fundamentals: (symbol) => getYahooFundamentals(yahoo(symbol)),
  statements: (symbol) => getYahooStatements(yahoo(symbol)),
};

/** Narrowest first. */
const LADDER: readonly NseIndexId[] = ["nifty50", "nifty100", "nifty200", "nifty500"];
/** Peers shown beside the stock. */
export const MAX_PEERS = 5;
/** Fewer than this in an index and the next, wider one is tried. */
const MIN_PEERS = 3;
/** Same-sector names priced to find the closest in size; bounds the provider calls for a big sector. */
const MAX_CANDIDATES = 14;
const CONCURRENCY = 4;

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

/**
 * The stock's sector and its same-sector companies, from the narrowest index
 * with at least MIN_PEERS of them; the widest index that has any otherwise.
 * Null when the stock isn't in the NIFTY 500 or NSE gives it no sector.
 */
export async function findSectorPeers(
  symbol: string,
  constituents: PeerDeps["constituents"]
): Promise<{ self: Constituent; peers: Constituent[]; universe: NseIndexId; source: string } | null> {
  let best: { self: Constituent; peers: Constituent[]; universe: NseIndexId; source: string } | null = null;
  for (const id of LADDER) {
    const list = await constituents(id).catch(() => null);
    const self = list?.constituents.find((c) => c.symbol === symbol);
    if (!list || !self?.sector) continue;
    const peers = list.constituents.filter((c) => c.symbol !== symbol && c.sector === self.sector);
    if (peers.length > 0) best = { self, peers, universe: id, source: list.source };
    if (peers.length >= MIN_PEERS) break;
  }
  return best;
}

async function priceRow(c: Constituent, isSelf: boolean, deps: PeerDeps): Promise<PeerRow> {
  const [history, fundamentals] = await Promise.all([deps.history(c.symbol).catch(() => null), deps.fundamentals(c.symbol).catch(() => null)]);
  const last = history?.candles.at(-1)?.c;
  const price = typeof last === "number" && last > 0 ? last : null;
  const previous = history?.previousClose && history.previousClose > 0 ? history.previousClose : null;
  const shares = fundamentals?.sharesOutstanding?.value;
  return {
    symbol: c.symbol,
    name: c.name || history?.name || null,
    isSelf,
    price: price === null ? null : Math.round(price * 100) / 100,
    changePercent: price !== null && previous !== null ? ((price - previous) / previous) * 100 : null,
    marketCap: price !== null && shares ? Math.round(price * shares) : null,
    pe: null,
    revenue: null,
    netMarginPct: null,
    fiscalYearEnd: null,
  };
}

export async function getPeers(rawSymbol: string, deps: PeerDeps = DEFAULT_DEPS): Promise<Peers | null> {
  const symbol = bareIndianSymbol(rawSymbol.trim().toUpperCase());
  const found = await findSectorPeers(symbol, deps.constituents);
  if (!found) return null;

  const self = await priceRow(found.self, true, deps);
  const candidates = await mapLimit(found.peers.slice(0, MAX_CANDIDATES), CONCURRENCY, (c) => priceRow(c, false, deps));

  // Closest in market value to the stock first; a peer whose value isn't known goes last, in index order.
  const distance = (row: PeerRow) => (self.marketCap && row.marketCap ? Math.abs(Math.log(row.marketCap / self.marketCap)) : Infinity);
  const chosen = candidates
    .map((row, index) => ({ row, index, d: distance(row) }))
    .sort((a, b) => a.d - b.d || a.index - b.index)
    .slice(0, MAX_PEERS)
    .map((entry) => entry.row);

  const rows = [self, ...chosen];
  const statements = await mapLimit(rows, CONCURRENCY, (row) => deps.statements(row.symbol).catch(() => null));
  rows.forEach((row, i) => {
    const year = statements[i]?.annual.at(-1);
    // Only when reported in rupees, so every row of the table is in one currency.
    if (!year || statements[i]?.currency !== "INR") return;
    row.revenue = year.values.revenue;
    row.netMarginPct = netMargin(year);
    const profit = year.values.netIncome;
    row.pe = row.marketCap !== null && typeof profit === "number" && profit > 0 ? row.marketCap / profit : null;
    row.fiscalYearEnd = year.asOf;
  });

  // Largest first, so the table reads like a league table with the stock in its place.
  rows.sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1));

  return {
    symbol,
    sector: found.self.sector!,
    universe: NSE_INDEX_UNIVERSES[found.universe].label,
    currency: "INR",
    rows,
    sectorSource: `NSE sector classification (${found.source})`,
  };
}

/** Peers change with prices; the list and fundamentals behind them are cached where they're fetched. */
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: Peers }>();

export async function getPeersCached(symbol: string, now: number = Date.now()): Promise<Peers | null> {
  const key = bareIndianSymbol(symbol.trim().toUpperCase());
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const value = await getPeers(key);
  if (value) {
    if (cache.size >= 300) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: now, value });
  }
  return value;
}
