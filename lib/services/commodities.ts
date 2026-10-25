import {
  getMcxCandles,
  getMcxIntradayCandles,
  getMcxQuotes,
  searchMcxFutures,
  type CandleUnit,
  type McxResult,
} from "../apis/upstoxCommodities";
import type { Candle } from "../apis/yahooChart";
import type { UpstoxErrorCode } from "../apis/upstox";
import {
  COMMODITIES,
  findCommodity,
  type CommodityProduct,
} from "../data/commodities";
import { contractMonth } from "../markets/commodities";
import type { HistoryRange } from "./history";

/**
 * MCX commodity futures from Upstox: the contracts open for each product, their
 * quotes and their price history.
 *
 * Nothing is estimated. A contract Upstox doesn't list isn't shown; a contract
 * with no trade yet keeps `price: null`; a product whose lookup failed is
 * reported in `unavailable` with the reason.
 */

export type CommodityContract = {
  symbol: string;
  instrumentKey: string;
  tradingSymbol: string;
  /** YYYY-MM-DD */
  expiry: string;
  lotSize: number | null;
  /** Quote units in one lot (Upstox qty_multiplier). */
  qtyMultiplier: number | null;
  /** In rupees (Upstox sends paise). */
  tickSize: number | null;
};

/**
 * live       traded in the last LIVE_WINDOW_MS: Upstox quotes are real time
 * last_trade the market is closed or the contract is quiet: the last traded price
 * no_trades  Upstox has no trade for this contract (price 0, no trade time)
 */
export type QuoteStatus = "live" | "last_trade" | "no_trades";

export type CommodityQuote = {
  status: QuoteStatus;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  /** In lots, as MCX reports it. */
  volume: number | null;
  openInterest: number | null;
  lastTradeTime: string | null;
};

export type CommodityRow = CommodityProduct & {
  contract: CommodityContract;
  quote: CommodityQuote | null;
  contractCount: number;
};

export type Unavailable = { symbol: string; name: string; reason: UpstoxErrorCode | "no_contracts" };

export type CommodityBoard = {
  rows: CommodityRow[];
  unavailable: Unavailable[];
  fetchedAt: string;
};

export type CommodityDetail = {
  product: CommodityProduct;
  contracts: { contract: CommodityContract; quote: CommodityQuote | null }[];
  fetchedAt: string;
};

/** What each Upstox failure means for a reader. */
export const COMMODITY_ERROR_MESSAGES: Record<UpstoxErrorCode, string> = {
  not_configured: "Commodity prices aren't set up on this server (no Upstox access token).",
  auth: "The Upstox session has expired, so commodity prices can't be loaded until it's renewed.",
  rate_limited: "Upstox is rate-limiting requests right now. Try again in a minute.",
  timeout: "Upstox took too long to answer. Try again.",
  not_found: "No open MCX contracts were found for this commodity.",
  provider: "Upstox couldn't provide commodity data right now.",
};

export const LIVE_WINDOW_MS = 10 * 60_000;
const IST_OFFSET_MS = 5.5 * 60 * 60_000;

/** Today's date in India (MCX's calendar), YYYY-MM-DD. */
export function istDate(now: number): string {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
}

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * One product's futures from raw search rows: only MCX_FO FUT rows for exactly
 * this underlying (a search for "GOLD" also returns GOLDM, GOLDPETAL…), not yet
 * expired, one per instrument key, nearest expiry first.
 */
export function parseContracts(rows: unknown[], symbol: string, today: string): CommodityContract[] {
  const seen = new Map<string, CommodityContract>();

  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const key = text(row.instrument_key);
    const expiry = text(row.expiry);
    const tradingSymbol = text(row.trading_symbol);

    if (
      row.segment !== "MCX_FO" ||
      row.instrument_type !== "FUT" ||
      text(row.underlying_symbol)?.toUpperCase() !== symbol ||
      !key ||
      !tradingSymbol ||
      !expiry ||
      !/^\d{4}-\d{2}-\d{2}$/.test(expiry) ||
      expiry < today ||
      seen.has(key)
    ) {
      continue;
    }

    const tick = num(row.tick_size);
    seen.set(key, {
      symbol,
      instrumentKey: key,
      tradingSymbol,
      expiry,
      lotSize: num(row.lot_size),
      qtyMultiplier: num(row.qty_multiplier),
      tickSize: tick === null ? null : tick / 100,
    });
  }

  return [...seen.values()].sort((a, b) => a.expiry.localeCompare(b.expiry));
}

/** Upstox's quote for one contract, or null when it isn't in the response. */
export function parseQuote(raw: unknown, now: number): CommodityQuote | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const ohlc = (row.ohlc && typeof row.ohlc === "object" ? row.ohlc : {}) as Record<string, unknown>;

  const lastTradeMs = Number(row.last_trade_time);
  const traded = Number.isFinite(lastTradeMs) && lastTradeMs > 0;
  const last = num(row.last_price);
  const price = traded && last !== null && last > 0 ? last : null;

  if (price === null) {
    return {
      status: "no_trades",
      price: null,
      change: null,
      changePercent: null,
      previousClose: null,
      open: null,
      high: null,
      low: null,
      volume: num(row.volume),
      openInterest: num(row.oi),
      lastTradeTime: null,
    };
  }

  const change = num(row.net_change);
  const previousClose = change !== null ? price - change : null;
  const positive = (value: number | null) => (value !== null && value > 0 ? value : null);

  return {
    status: now - lastTradeMs <= LIVE_WINDOW_MS ? "live" : "last_trade",
    price,
    change,
    changePercent: change !== null && previousClose ? (change / previousClose) * 100 : null,
    previousClose,
    open: positive(num(ohlc.open)),
    high: positive(num(ohlc.high)),
    low: positive(num(ohlc.low)),
    volume: num(row.volume),
    openInterest: num(row.oi),
    lastTradeTime: new Date(lastTradeMs).toISOString(),
  };
}

/** Quotes keyed by instrument key (the response is keyed by trading symbol). */
export function quotesByKey(data: Record<string, unknown>, now: number): Map<string, CommodityQuote> {
  const map = new Map<string, CommodityQuote>();
  for (const raw of Object.values(data)) {
    const key = raw && typeof raw === "object" ? text((raw as Record<string, unknown>).instrument_token) : null;
    const quote = parseQuote(raw, now);
    if (key && quote) map.set(key, quote);
  }
  return map;
}

/* ------------------------------------------------------------ loaders */

export interface CommodityDeps {
  search: typeof searchMcxFutures;
  quotes: typeof getMcxQuotes;
  now: () => number;
}

const CONTRACT_TTL_MS = 6 * 60 * 60_000;
const QUOTE_TTL_MS = 20_000;
const SEARCH_CONCURRENCY = 4;

async function mapLimited<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]);
      }
    })
  );
  return results;
}

export function createCommodityLoader(deps: CommodityDeps = { search: searchMcxFutures, quotes: getMcxQuotes, now: Date.now }) {
  const contractCache = new Map<string, { at: number; contracts: CommodityContract[] }>();
  let boardCache: { at: number; board: CommodityBoard } | null = null;
  const detailCache = new Map<string, { at: number; detail: CommodityDetail }>();

  async function contractsFor(product: CommodityProduct): Promise<McxResult<CommodityContract[]>> {
    const hit = contractCache.get(product.symbol);
    const today = istDate(deps.now());
    if (hit && deps.now() - hit.at < CONTRACT_TTL_MS) {
      return { ok: true, value: hit.contracts.filter((contract) => contract.expiry >= today) };
    }

    const result = await deps.search(product.symbol);
    if (!result.ok) return result;
    const contracts = parseContracts(result.value, product.symbol, today);
    if (contracts.length > 0) contractCache.set(product.symbol, { at: deps.now(), contracts });
    return { ok: true, value: contracts };
  }

  async function getBoard(): Promise<McxResult<CommodityBoard>> {
    if (boardCache && deps.now() - boardCache.at < QUOTE_TTL_MS) return { ok: true, value: boardCache.board };

    const lookups = await mapLimited(COMMODITIES, SEARCH_CONCURRENCY, async (product) => ({
      product,
      result: await contractsFor(product),
    }));

    const unavailable: Unavailable[] = [];
    const listed: { product: CommodityProduct; contracts: CommodityContract[] }[] = [];
    for (const { product, result } of lookups) {
      if (!result.ok) unavailable.push({ symbol: product.symbol, name: product.name, reason: result.code });
      else if (result.value.length === 0) unavailable.push({ symbol: product.symbol, name: product.name, reason: "no_contracts" });
      else listed.push({ product, contracts: result.value });
    }

    if (listed.length === 0) {
      const failure = unavailable.find((entry) => entry.reason !== "no_contracts");
      return { ok: false, code: failure ? (failure.reason as UpstoxErrorCode) : "not_found" };
    }

    const quoteResult = await deps.quotes(listed.map(({ contracts }) => contracts[0].instrumentKey));
    if (!quoteResult.ok) return quoteResult;
    const quotes = quotesByKey(quoteResult.value, deps.now());

    const board: CommodityBoard = {
      rows: listed.map(({ product, contracts }) => ({
        ...product,
        contract: contracts[0],
        quote: quotes.get(contracts[0].instrumentKey) ?? null,
        contractCount: contracts.length,
      })),
      unavailable,
      fetchedAt: new Date(deps.now()).toISOString(),
    };

    boardCache = { at: deps.now(), board };
    return { ok: true, value: board };
  }

  async function getDetail(symbol: string): Promise<McxResult<CommodityDetail>> {
    const product = findCommodity(symbol);
    if (!product) return { ok: false, code: "not_found" };

    const hit = detailCache.get(product.symbol);
    if (hit && deps.now() - hit.at < QUOTE_TTL_MS) return { ok: true, value: hit.detail };

    const contracts = await contractsFor(product);
    if (!contracts.ok) return contracts;
    if (contracts.value.length === 0) return { ok: false, code: "not_found" };

    const quoteResult = await deps.quotes(contracts.value.map((contract) => contract.instrumentKey));
    if (!quoteResult.ok) return quoteResult;
    const quotes = quotesByKey(quoteResult.value, deps.now());

    const detail: CommodityDetail = {
      product,
      contracts: contracts.value.map((contract) => ({ contract, quote: quotes.get(contract.instrumentKey) ?? null })),
      fetchedAt: new Date(deps.now()).toISOString(),
    };
    detailCache.set(product.symbol, { at: deps.now(), detail });
    return { ok: true, value: detail };
  }

  return { getBoard, getDetail, contractsFor };
}

const loader = createCommodityLoader();
export const getCommodityBoard = loader.getBoard;
export const getCommodityDetail = loader.getDetail;
export const getCommodityContracts = loader.contractsFor;

/* ------------------------------------------------------------ history */

/**
 * Chart resolution per range, within Upstox's limits (1–15 minute candles
 * span at most a month per request; 30-minute and hourly at most a quarter).
 * A futures contract only trades from its listing, so the long ranges show
 * the contract's whole life, which is all that exists.
 */
const HISTORY_PLAN: Record<HistoryRange, { unit: CandleUnit; interval: number; days: number; sessions?: number }> = {
  "1d": { unit: "minutes", interval: 1, days: 7, sessions: 1 },
  "5d": { unit: "minutes", interval: 5, days: 10, sessions: 5 },
  "1mo": { unit: "minutes", interval: 30, days: 31 },
  "3mo": { unit: "hours", interval: 1, days: 92 },
  "6mo": { unit: "days", interval: 1, days: 183 },
  "1y": { unit: "days", interval: 1, days: 366 },
  "3y": { unit: "days", interval: 1, days: 1096 },
  "5y": { unit: "days", interval: 1, days: 1827 },
  max: { unit: "days", interval: 1, days: 3650 },
};

export type CommodityHistory = {
  type: "commodity";
  symbol: string;
  name: string;
  unit: "currency";
  currency: "INR";
  range: HistoryRange;
  interval: string;
  candles: Candle[];
  previousClose: number | null;
  fiftyTwoWeekHigh: null;
  fiftyTwoWeekLow: null;
  marketTime: string | null;
  sessionStart: null;
  sessionEnd: null;
  source: "Upstox";
  contract: CommodityContract;
};

/** Upstox candle rows ([time, o, h, l, c, volume, oi]) → ascending candles. */
export function toCandles(rows: unknown[]): Candle[] {
  return rows
    .flatMap((row) => {
      if (!Array.isArray(row) || row.length < 5) return [];
      const t = Date.parse(String(row[0]));
      const c = num(row[4]);
      return Number.isFinite(t) && c !== null
        ? [{ t, o: num(row[1]), h: num(row[2]), l: num(row[3]), c, v: num(row[5]) }]
        : [];
    })
    .sort((a, b) => a.t - b.t);
}

/** Keep the newest `sessions` trading days (by IST date). */
export function lastSessions(candles: Candle[], sessions: number): Candle[] {
  const dates = [...new Set(candles.map((candle) => istDate(candle.t)))].sort();
  const keep = new Set(dates.slice(-sessions));
  return candles.filter((candle) => keep.has(istDate(candle.t)));
}

export interface CommodityHistoryDeps {
  contracts: (product: CommodityProduct) => Promise<McxResult<CommodityContract[]>>;
  candles: typeof getMcxCandles;
  intraday: typeof getMcxIntradayCandles;
  quotes: typeof getMcxQuotes;
  now: () => number;
}

const HISTORY_TTL_MS = 60_000;

export function createCommodityHistoryLoader(
  deps: CommodityHistoryDeps = {
    contracts: getCommodityContracts,
    candles: getMcxCandles,
    intraday: getMcxIntradayCandles,
    quotes: getMcxQuotes,
    now: Date.now,
  }
) {
  const cache = new Map<string, { at: number; history: CommodityHistory }>();

  return async function getCommodityHistory(
    symbol: string,
    expiry: string | null,
    range: HistoryRange
  ): Promise<McxResult<CommodityHistory | null>> {
    const product = findCommodity(symbol);
    if (!product) return { ok: false, code: "not_found" };

    const contracts = await deps.contracts(product);
    if (!contracts.ok) return contracts;
    const contract = expiry ? contracts.value.find((c) => c.expiry === expiry) : contracts.value[0];
    if (!contract) return { ok: false, code: "not_found" };

    const key = `${contract.instrumentKey}|${range}`;
    const hit = cache.get(key);
    if (hit && deps.now() - hit.at < HISTORY_TTL_MS) return { ok: true, value: hit.history };

    const plan = HISTORY_PLAN[range];
    const today = istDate(deps.now());
    const from = istDate(deps.now() - plan.days * 86_400_000);

    const [past, live] = await Promise.all([
      deps.candles(contract.instrumentKey, plan.unit, plan.interval, from, today),
      plan.unit === "days" ? Promise.resolve(null) : deps.intraday(contract.instrumentKey, plan.unit, plan.interval),
    ]);
    if (!past.ok) return past;

    const merged = new Map<number, Candle>();
    for (const candle of [...toCandles(past.value), ...(live?.ok ? toCandles(live.value) : [])]) merged.set(candle.t, candle);
    let candles = [...merged.values()].sort((a, b) => a.t - b.t);
    if (plan.sessions) candles = lastSessions(candles, plan.sessions);
    if (candles.length === 0) return { ok: true, value: null };

    // The day's reference line: the quote's previous close, which belongs to
    // the session the quote describes — the newest one shown.
    let previousClose: number | null = null;
    if (range === "1d") {
      const quote = await deps.quotes([contract.instrumentKey]);
      if (quote.ok) previousClose = quotesByKey(quote.value, deps.now()).get(contract.instrumentKey)?.previousClose ?? null;
    }

    const history: CommodityHistory = {
      type: "commodity",
      symbol: product.symbol,
      name: `${product.name} ${contractMonth(contract.expiry)} futures`,
      unit: "currency",
      currency: "INR",
      range,
      interval: `${plan.interval}${plan.unit === "minutes" ? "m" : plan.unit === "hours" ? "h" : "d"}`,
      candles,
      previousClose,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      marketTime: new Date(candles[candles.length - 1].t).toISOString(),
      sessionStart: null,
      sessionEnd: null,
      source: "Upstox",
      contract,
    };
    cache.set(key, { at: deps.now(), history });
    return { ok: true, value: history };
  };
}

export const getCommodityHistory = createCommodityHistoryLoader();
