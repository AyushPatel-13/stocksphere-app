import { getFinancialMetrics } from "../apis/finnhubFinancials";
import { searchUpstoxEquity } from "../apis/upstox";
import { getUpstoxKeyRatios } from "../apis/upstoxFundamentals";
import { normalizeUpstoxFinancials } from "../adapters/financials";

/**
 * The provider-level payload the financials tool consumes.
 *
 * Fields are optional and nullable rather than narrowed to `number`, because
 * the Finnhub tier passes its values straight through and
 * mapFinancialMetrics() (lib/agent/tools/financialsTool.ts) is what coerces
 * them: toNullable() turns undefined or non-numeric values into null. This is
 * the same shape lib/services/financials.ts returned before this provider
 * layer existed, so the existing consumers typecheck unchanged.
 */
export interface RawFinancialMetrics {
  marketCap?: number | null;
  pe?: number | null;
  eps?: number | null;
  dividendYield?: number | null;
  week52High?: number | null;
  week52Low?: number | null;
  roe?: number | null;
}

/**
 * Injected lookups, following the same convention as
 * createSymbolResolverTool()'s searchIndianCandidates parameter — tests supply
 * fakes, so nothing needs UPSTOX_ACCESS_TOKEN, FINNHUB_API_KEY or a network.
 */
export type IndianInstrumentLookup = (
  symbol: string
) => Promise<{ isin?: string } | null>;

export type IndianKeyRatiosLookup = (
  isin: string
) => Promise<{ name?: unknown; company_value?: unknown }[] | null>;

/**
 * The Finnhub /stock/metric response, narrowed to what this path reads.
 *
 * The index signature covers the other top-level keys Finnhub returns
 * (symbol, metricType, ...) and error bodies such as { error: "..." }, which
 * carry no `metric` at all.
 */
export interface GlobalMetricsPayload {
  metric?: Record<string, number | null | undefined>;
  [key: string]: unknown;
}

export type GlobalMetricsLookup = (
  symbol: string
) => Promise<GlobalMetricsPayload | null | undefined>;

// Mirrors the routing rule in lib/providers/market.provider.ts, where
// isIndianSymbol/normalizeIndianSymbol are module-private and therefore not
// importable. Kept identical so the financials path, the quote path and the
// company path all agree on what counts as an Indian symbol.
function isIndianSymbol(symbol: string): boolean {
  return (
    symbol.endsWith(".NS") ||
    symbol.endsWith(".BSE")
  );
}

function normalizeIndianSymbol(symbol: string): string {
  return symbol
    .replace(".NS", "")
    .replace(".BSE", "")
    .toUpperCase();
}

/**
 * Indian equities: Upstox only, with no fallback.
 *
 * This mirrors getIndianMarketQuote() in lib/providers/market.provider.ts —
 * the established rule for Indian symbols is that Upstox answers or nothing
 * does. There is deliberately no Finnhub fallback: Finnhub returns HTTP 403
 * for every ".NS" symbol on this plan, so a fallback would only add a wasted
 * round trip. The bare trading symbol is used for the Upstox instrument lookup
 * and nowhere else.
 */
export async function fetchIndianFinancials(
  symbol: string,
  lookupInstrument: IndianInstrumentLookup = searchUpstoxEquity,
  lookupKeyRatios: IndianKeyRatiosLookup = getUpstoxKeyRatios
) {
  try {
    // ".NS"/".BSE" is dropped for this Upstox instrument lookup only. Upstox
    // has no suffix concept and its search is an exact match on the NSE
    // trading symbol. The canonical symbol is never rewritten.
    const instrument = await lookupInstrument(
      normalizeIndianSymbol(symbol)
    );

    // Fundamentals are keyed by ISIN, so an unresolved instrument means there
    // is nothing to look up.
    if (!instrument?.isin) {
      return null;
    }

    const rows = await lookupKeyRatios(instrument.isin);

    if (!rows) {
      return null;
    }

    console.log("✅ Upstox Financials");

    return {
      provider: "Upstox",
      data: normalizeUpstoxFinancials(rows),
    };
  } catch {
    // Covers a missing/expired UPSTOX_ACCESS_TOKEN, which getUpstoxKeyRatios()
    // throws on. Callers must never see it.
    return null;
  }
}

/**
 * Non-Indian symbols: Finnhub, unchanged.
 *
 * The seven-field projection below is the same one lib/services/financials.ts
 * performed before this provider layer existed, so behaviour is preserved.
 */
export async function fetchGlobalFinancials(
  symbol: string,
  lookupMetrics: GlobalMetricsLookup = getFinancialMetrics
) {
  try {
    const data = await lookupMetrics(symbol);

    if (data?.metric) {
      console.log("✅ Finnhub Financials");

      const metrics: RawFinancialMetrics = {
        marketCap: data.metric.marketCapitalization,

        pe: data.metric.peTTM,

        eps: data.metric.epsTTM,

        dividendYield:
          data.metric.dividendYieldIndicatedAnnual,

        week52High: data.metric["52WeekHigh"],

        week52Low: data.metric["52WeekLow"],

        roe: data.metric.roeTTM,
      };

      return {
        provider: "Finnhub",
        data: metrics,
      };
    }
  } catch {}

  return null;
}

/**
 * Universal financials entry point: Indian symbols route to Upstox, everything
 * else to Finnhub.
 */
export async function fetchFinancials(
  symbol: string,
  lookupIndianInstrument: IndianInstrumentLookup = searchUpstoxEquity,
  lookupIndianKeyRatios: IndianKeyRatiosLookup = getUpstoxKeyRatios,
  lookupGlobalMetrics: GlobalMetricsLookup = getFinancialMetrics
) {
  if (isIndianSymbol(symbol)) {
    return fetchIndianFinancials(
      symbol,
      lookupIndianInstrument,
      lookupIndianKeyRatios
    );
  }

  return fetchGlobalFinancials(
    symbol,
    lookupGlobalMetrics
  );
}
