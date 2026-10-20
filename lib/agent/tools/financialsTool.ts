import { z } from "zod";
import { getFinancials } from "@/lib/services/financials";
import { getMarketQuote } from "@/lib/providers/market.provider";
import { fiftyTwoWeekRange, getHistory, resolveAsset } from "@/lib/services/history";
import { getYahooDividends, getYahooFundamentals, type YahooDividends, type YahooFundamentals } from "@/lib/apis/yahooFundamentals";
import { buildKeyStats, formatMarketCap } from "@/lib/services/keyStats";
import { ToolDefinition, FinancialMetrics, okResult, failResult } from "../types";

// Note: lib/services/financials.ts routes Indian symbols (.NS/.BSE) through
// Upstox and everything else through Finnhub, but it does not surface which of
// those actually answered, so this source label stays generic rather than
// claiming a specific provider.
const SOURCE = "StockSphere Financials Service";

const argsSchema = z.object({
  symbol: z.string().trim().min(1).max(20),
});

export type FinancialsToolArgs = z.infer<typeof argsSchema>;

function toNullable(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Exported for direct unit testing: asserts undefined/non-numeric fields
// become null, never 0, and that an all-null result is treated as "no data".
export function mapFinancialMetrics(raw: {
  marketCap?: unknown;
  pe?: unknown;
  pb?: unknown;
  eps?: unknown;
  dividendYield?: unknown;
  week52High?: unknown;
  week52Low?: unknown;
  roe?: unknown;
  roa?: unknown;
  roce?: unknown;
  evToEbitda?: unknown;
}): FinancialMetrics {
  return {
  marketCap: toNullable(raw.marketCap),
  pe: toNullable(raw.pe),
  pb: toNullable(raw.pb),
  eps: toNullable(raw.eps),
  dividendYield: toNullable(raw.dividendYield),
  week52High: toNullable(raw.week52High),
  week52Low: toNullable(raw.week52Low),
  roe: toNullable(raw.roe),
  roa: toNullable(raw.roa),
  roce: toNullable(raw.roce),
  evToEbitda: toNullable(raw.evToEbitda),
};
}

function hasAnyMetric(metrics: FinancialMetrics): boolean {
  return Object.values(metrics).some((value) => value !== null);
}

export const financialsTool: ToolDefinition<FinancialsToolArgs, FinancialMetrics> = {
  name: "get_financials",
  description:
    "Key metrics for a stock ticker: market cap (in the stock's own currency), P/E, EPS (TTM), dividend yield, 52-week high/low, P/B, ROE, ROA, ROCE, EV/EBITDA, with a `sources` entry saying where each figure came from. null means unavailable — say so, never zero.",
  parameters: {
    type: "object",
    properties: {
      symbol: {
        type: "string",
        description: "Stock ticker symbol, e.g. AAPL, TCS.NS, INFY.NS",
      },
    },
    required: ["symbol"],
  },
  argsSchema,
  async execute({ symbol }) {
    try {
      const enriched = await getEnrichedFinancials(symbol);
      if (!enriched || !hasAnyMetric(enriched)) {
        return failResult(SOURCE);
      }
      return okResult(enriched, SOURCE);
    } catch {
      return failResult(SOURCE);
    }
  },
};

/* ------------------------------------------------------------ enrichment */

export type EnrichedFinancials = FinancialMetrics & {
  currency: string | null;
  /** Market cap as the market quotes it (₹ lakh crore / crore, $T / $B) — quote this. */
  marketCapDisplay: string | null;
  /** Where each non-null metric came from, so the answer can cite it. */
  sources: Partial<Record<keyof FinancialMetrics, string>>;
};

export type EnrichDeps = {
  financials: (symbol: string) => Promise<Record<string, unknown> | null>;
  quote: (symbol: string) => Promise<{ price: number; currency: string } | null>;
  yahooSymbol: (symbol: string) => string | null;
  fundamentals: (yahooSymbol: string) => Promise<YahooFundamentals | null>;
  dividends: (yahooSymbol: string) => Promise<YahooDividends | null>;
  range52w: (symbol: string) => Promise<{ high: number; low: number } | null>;
};

const defaultDeps: EnrichDeps = {
  financials: async (symbol) => (await getFinancials(symbol)) as Record<string, unknown> | null,
  quote: async (symbol) => {
    const q = await getMarketQuote(symbol);
    return q && typeof q.price === "number" && q.price > 0 ? { price: q.price, currency: q.currency ?? "" } : null;
  },
  yahooSymbol: (symbol) => resolveAsset("stock", symbol)?.yahoo ?? null,
  fundamentals: getYahooFundamentals,
  dividends: getYahooDividends,
  range52w: async (symbol) => {
    const asset = resolveAsset("stock", symbol);
    return asset ? fiftyTwoWeekRange(await getHistory(asset, "1y")) : null;
  },
};

/**
 * The provider's metrics (Upstox for India, Finnhub elsewhere) with the gaps
 * filled from real data, exactly as the stock page does (lib/services/keyStats):
 * market cap = price × shares outstanding, EPS and dividends from Yahoo, the
 * 52-week range from price history. Finnhub's market cap (in millions) is
 * replaced by the computed one so units are always the stock's currency.
 */
export async function getEnrichedFinancials(symbol: string, deps: EnrichDeps = defaultDeps): Promise<EnrichedFinancials | null> {
  const yahooSymbol = deps.yahooSymbol(symbol);
  const [raw, quote, fundamentals, dividends, range] = await Promise.all([
    deps.financials(symbol).catch(() => null),
    deps.quote(symbol).catch(() => null),
    yahooSymbol ? deps.fundamentals(yahooSymbol).catch(() => null) : Promise.resolve(null),
    yahooSymbol ? deps.dividends(yahooSymbol).catch(() => null) : Promise.resolve(null),
    deps.range52w(symbol).catch(() => null),
  ]);

  const base = raw ? mapFinancialMetrics(raw) : mapFinancialMetrics({});
  const providerName = quote?.currency === "INR" || symbol.toUpperCase().endsWith(".NS") ? "Upstox" : "Finnhub";
  const stats = buildKeyStats({ price: quote?.price ?? null, provider: base, providerName, yahoo: fundamentals, dividends });

  const sources: EnrichedFinancials["sources"] = {};
  for (const key of Object.keys(base) as (keyof FinancialMetrics)[]) {
    if (base[key] !== null) sources[key] = providerName;
  }

  const currency = quote?.currency ?? fundamentals?.currency ?? null;
  const result: EnrichedFinancials = { ...base, currency, marketCapDisplay: null, sources };
  // Provider market caps (Finnhub: millions) are never mixed with computed ones.
  result.marketCap = stats.marketCap?.value ?? null;
  if (stats.marketCap) {
    sources.marketCap = stats.marketCap.source;
    result.marketCapDisplay = formatMarketCap(stats.marketCap.value, currency);
  }
  else delete sources.marketCap;
  for (const key of ["pe", "eps", "dividendYield"] as const) {
    if (stats[key]) {
      result[key] = stats[key]!.value;
      sources[key] = stats[key]!.source;
    }
  }
  if (result.week52High === null && result.week52Low === null && range) {
    result.week52High = range.high;
    result.week52Low = range.low;
    sources.week52High = sources.week52Low = "Price history (Yahoo, last 12 months)";
  }
  return result;
}
