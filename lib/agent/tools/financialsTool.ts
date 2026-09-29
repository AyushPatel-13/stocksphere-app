import { z } from "zod";
import { getFinancials } from "@/lib/services/financials";
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
  eps?: unknown;
  dividendYield?: unknown;
  week52High?: unknown;
  week52Low?: unknown;
  roe?: unknown;
}): FinancialMetrics {
  return {
    marketCap: toNullable(raw.marketCap),
    pe: toNullable(raw.pe),
    eps: toNullable(raw.eps),
    dividendYield: toNullable(raw.dividendYield),
    week52High: toNullable(raw.week52High),
    week52Low: toNullable(raw.week52Low),
    roe: toNullable(raw.roe),
  };
}

function hasAnyMetric(metrics: FinancialMetrics): boolean {
  return Object.values(metrics).some((value) => value !== null);
}

export const financialsTool: ToolDefinition<FinancialsToolArgs, FinancialMetrics> = {
  name: "get_financials",
  description:
    "Get basic financial metrics for a stock ticker symbol: market cap, P/E ratio, EPS, dividend yield, 52-week high/low, ROE. Use this for 'P/E', 'market cap', 'dividend yield', 'financials' type questions. Any metric the provider didn't return will be null — report it as unavailable, never as zero.",
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
      const financials = await getFinancials(symbol);
      if (!financials) {
        return failResult(SOURCE);
      }

      const normalized = mapFinancialMetrics(financials);

      if (!hasAnyMetric(normalized)) {
        return failResult(SOURCE);
      }

      return okResult(normalized, SOURCE);
    } catch {
      return failResult(SOURCE);
    }
  },
};
