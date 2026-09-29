import { getHistoricalData } from "../apis/twelvedata";
import { searchUpstoxEquity } from "../apis/upstox";
import {
  getUpstoxHistoricalCandles,
  type UpstoxCandleRow,
} from "../apis/upstoxHistorical";
import { normalizeUpstoxCandles } from "../adapters/historical";
import { HistoricalPayload, HistoricalRange } from "../types/historical";

/**
 * Injected lookups, following the same convention as lib/providers/news.ts and
 * createSymbolResolverTool()'s searchIndianCandidates parameter — tests supply
 * fakes, so nothing needs UPSTOX_ACCESS_TOKEN, TWELVE_DATA_API_KEY or a network.
 */
export type IndianInstrumentLookup = (
  symbol: string
) => Promise<{ instrument_key?: string } | null>;

export type IndianCandleLookup = (
  instrumentKey: string,
  fromDate: string,
  toDate: string
) => Promise<UpstoxCandleRow[] | null>;

export type GlobalHistoricalLookup = (
  symbol: string
) => Promise<HistoricalPayload | null>;

const DAY_MS = 86400000;

/**
 * Calendar days to fetch per range: an OVER-FETCH, deliberately wider than the
 * range needs.
 *
 * get_historical still reduces the payload to a trading-day count itself
 * (RANGE_TRADING_DAYS), so these windows only decide how much history is
 * available to slice from — they never decide the answer. Each one is sized so
 * that the count the tool asks for actually fits inside it, which is not
 * obvious: a year of sessions is ~252 trading days but ~365 calendar days, so
 * calendar time runs about 1.45 days per session, and holidays push that higher
 * for shorter windows.
 *
 * Measured live, one window per range against the 22/66/132/252 targets: an
 * exactly-proportional window under-delivers (a 190-day "6m" returned 127
 * sessions, five short), and a window sitting exactly on the boundary (a
 * 96-day "3m" returning exactly 66) would fall short on a holiday-heavy
 * quarter. Each is therefore rounded up with margin. A window that was exactly
 * 365 days would hand the tool a short year and quietly break the range
 * contract.
 */
const RANGE_WINDOW_DAYS: Record<Exclude<HistoricalRange, "max">, number> = {
  "1m": 35,
  "3m": 102,
  "6m": 202,
  "1y": 384,
};

/**
 * The window used when no range is given — the stock page's case, since
 * app/stock/[symbol]/page.tsx calls the service with a symbol only.
 *
 * Five years, because that is the widest span components/Stock/StockChart.tsx
 * can ask for (its "5Y" button slices up to 1825 rows). It used to receive a
 * flat 365 bars, so that button could only ever draw one year.
 */
const DEFAULT_WINDOW_DAYS = 1825;

/**
 * How far back "max" actually reaches.
 *
 * Upstox answers HTTP 400 "Invalid date range" for a from_date beyond roughly
 * ten years ago (verified live: 2016-09-01 refused, 2016-10-01 accepted), so
 * "max" cannot mean unlimited. Nine years is chosen to sit a clear year inside
 * that boundary and is computed relative to today, so it does not rot into a
 * failing request as the calendar advances.
 */
const MAX_LOOKBACK_YEARS = 9;

// Mirrors the routing rule in lib/providers/market.provider.ts, where
// isIndianSymbol/normalizeIndianSymbol are module-private and therefore not
// importable. Kept identical so the historical path, the news path, the quote
// path, the company path and the financials path all agree on what counts as an
// Indian symbol.
//
// Note this is case-sensitive, so "tcs.ns" is not recognised as Indian — an
// inherited limitation of the rule, not a new one, and the symbol resolver
// canonicalises to upper case before any tool reaches here.
function isIndianSymbol(symbol: string): boolean {
  return symbol.endsWith(".NS") || symbol.endsWith(".BSE");
}

function normalizeIndianSymbol(symbol: string): string {
  return symbol.replace(".NS", "").replace(".BSE", "").toUpperCase();
}

function isoDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/** The Upstox date window to request for a range. */
function upstoxWindow(range: HistoricalRange | undefined): {
  fromDate: string;
  toDate: string;
} {
  const toDate = isoDate(new Date());

  if (range === "max") {
    const earliest = new Date();
    earliest.setFullYear(earliest.getFullYear() - MAX_LOOKBACK_YEARS);

    return { fromDate: isoDate(earliest), toDate };
  }

  const days = range ? RANGE_WINDOW_DAYS[range] : DEFAULT_WINDOW_DAYS;

  return { fromDate: isoDate(new Date(Date.now() - days * DAY_MS)), toDate };
}

/**
 * Indian equities: Upstox only, with no fallback.
 *
 * This mirrors fetchIndianNews()/getIndianMarketQuote()/fetchIndianFinancials()
 * — the established rule for Indian symbols is that Upstox answers or nothing
 * does. There is deliberately no TwelveData fallback: TwelveData answers HTTP
 * 404 for every ".NS" symbol ("symbol or figi parameter is missing or invalid"),
 * and stripping the suffix to make it answer is not an option, because its bare
 * namespace is a different security. Live: bare "INFY" returns the NYSE ADR in
 * USD at 10.53, not Infosys Ltd on NSE at ~1,000. The bare trading symbol is
 * used for the Upstox instrument lookup and nowhere else; it is never sent to a
 * global provider.
 *
 * Returns null only when the provider genuinely failed. A successful response
 * with no candles is `data: { values: [] }`, which is a different thing and must
 * stay distinguishable — see lib/agent/tools/historicalTool.ts.
 */
export async function fetchIndianHistorical(
  symbol: string,
  range?: HistoricalRange,
  lookupInstrument: IndianInstrumentLookup = searchUpstoxEquity,
  lookupCandles: IndianCandleLookup = getUpstoxHistoricalCandles
) {
  try {
    // ".NS"/".BSE" is dropped for this Upstox instrument lookup only. Upstox has
    // no suffix concept and its search is an exact match on the NSE trading
    // symbol. The canonical symbol is never rewritten.
    const instrument = await lookupInstrument(
      normalizeIndianSymbol(symbol)
    );

    // Candles are keyed by instrument_key, so an unresolved instrument means
    // there is nothing to ask about.
    if (!instrument?.instrument_key) {
      return null;
    }

    const { fromDate, toDate } = upstoxWindow(range);

    const rows = await lookupCandles(
      instrument.instrument_key,
      fromDate,
      toDate
    );

    // null means the request could not be read; [] means it was read and holds
    // no candles in that window.
    if (rows === null) {
      return null;
    }

    console.log("✅ Upstox Historical");

    return {
      provider: "Upstox",
      data: normalizeUpstoxCandles(rows),
    };
  } catch {
    // Covers a missing/expired UPSTOX_ACCESS_TOKEN, which
    // getUpstoxHistoricalCandles() throws on. Callers must never see it.
    return null;
  }
}

/**
 * Non-Indian symbols: TwelveData, unchanged.
 *
 * `values` is still tested for truthiness rather than length, so an empty
 * `values: []` keeps travelling as a successful-but-empty payload exactly as it
 * does today.
 */
export async function fetchGlobalHistorical(
  symbol: string,
  lookupHistorical: GlobalHistoricalLookup = getHistoricalData
) {
  try {
    const historical = await lookupHistorical(symbol);

    if (historical?.values) {
      console.log("✅ Twelve Historical");

      return {
        provider: "TwelveData",
        data: historical,
      };
    }
  } catch {}

  return null;
}

/**
 * Universal historical entry point: Indian symbols route to Upstox, everything
 * else to TwelveData.
 *
 * `range` is optional and reaches the Indian path only, where it selects the
 * date window to request. The returned payload shape is identical either way,
 * which is why neither app/stock/[symbol]/page.tsx nor StockChart.tsx changes.
 */
export async function fetchHistorical(
  symbol: string,
  range?: HistoricalRange,
  lookupIndianInstrument: IndianInstrumentLookup = searchUpstoxEquity,
  lookupIndianCandles: IndianCandleLookup = getUpstoxHistoricalCandles,
  lookupGlobalHistorical: GlobalHistoricalLookup = getHistoricalData
) {
  if (isIndianSymbol(symbol)) {
    return fetchIndianHistorical(
      symbol,
      range,
      lookupIndianInstrument,
      lookupIndianCandles
    );
  }

  return fetchGlobalHistorical(symbol, lookupGlobalHistorical);
}
