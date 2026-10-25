import { z } from "zod";

import type { Candle } from "@/lib/apis/yahooChart";
import { getHistory, resolveAsset, type History } from "@/lib/services/history";
import { ToolDefinition, failResult, okResult, type SymbolCandidate, type SymbolResolution } from "../types";
import { pickCandidate, RENAMED_COMPANIES, stripIndianSuffix, symbolResolverTool } from "./symbolResolverTool";

export { pickCandidate };

/**
 * One call for "how has X done" and "compare X and Y": resolves each name,
 * reads its price history and computes the period return in code, so the
 * model gets finished numbers instead of raw candles to do arithmetic on.
 * A name that matches more than one company is returned as ambiguous with
 * its candidates — never guessed.
 */

const SOURCE = "StockSphere Performance (Yahoo Finance history, may be delayed)";

export const PERIODS = ["1w", "1m", "3m", "6m", "ytd", "1y", "3y", "5y"] as const;
export type Period = (typeof PERIODS)[number];

// "ytd" has no fixed length: it starts from the last close of the previous
// calendar year (see cutoffFor).
const PERIOD_DAYS: Record<Exclude<Period, "ytd">, number> = { "1w": 7, "1m": 30, "3m": 91, "6m": 182, "1y": 365, "3y": 1095, "5y": 1826 };

/** The latest time the start bar may have: the period's length before the end, or 31 Dec of last year for ytd. */
function cutoffFor(endT: number, period: Period): number {
  if (period === "ytd") return Date.UTC(new Date(endT).getUTCFullYear(), 0, 1) - 1;
  return endT - PERIOD_DAYS[period] * 86_400_000;
}

/**
 * How many days after the cutoff the first available bar may fall and still
 * stand as the start (a provider's "1 year" often begins a day or two late;
 * weekly bars can be up to a week off). The dates used are always reported.
 */
const START_TOLERANCE_DAYS: Record<Period, number> = { "1w": 2, "1m": 4, "3m": 5, "6m": 5, ytd: 7, "1y": 7, "3y": 10, "5y": 10 };

const argsSchema = z.object({
  stocks: z.array(z.string().trim().min(1).max(60)).min(1).max(5),
  period: z.enum(PERIODS),
});

export type PerformanceArgs = z.infer<typeof argsSchema>;

export type PerformanceRow =
  | {
      query: string;
      status: "ok";
      symbol: string;
      name: string;
      currency: string | null;
      startDate: string;
      startClose: number;
      endDate: string;
      endClose: number;
      returnPct: number;
      /** Compound yearly return, for periods of a year or more. */
      annualisedPct: number | null;
      periodHigh: number;
      periodLow: number;
      bars: "daily" | "weekly";
    }
  | { query: string; status: "ambiguous"; candidates: SymbolCandidate[] }
  | { query: string; status: "not_found" | "no_data"; symbol?: string };

export type PerformanceResult = { period: Period; rows: PerformanceRow[] };

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Period return from bars: last close vs the last close on or before (end − period). */
export function periodReturn(candles: Candle[], period: Period): Omit<Extract<PerformanceRow, { status: "ok" }>, "query" | "status" | "symbol" | "name" | "currency" | "bars"> | null {
  const bars = candles.filter((c) => c.c > 0).sort((a, b) => a.t - b.t);
  if (bars.length < 2) return null;
  const end = bars[bars.length - 1];
  const cutoff = cutoffFor(end.t, period);
  let startIndex = bars.findLastIndex((b) => b.t <= cutoff);
  if (startIndex < 0 && bars[0].t - cutoff <= START_TOLERANCE_DAYS[period] * 86_400_000) startIndex = 0;
  // History doesn't reach back far enough: say so rather than shorten the period.
  if (startIndex < 0 || startIndex === bars.length - 1) return null;

  const start = bars[startIndex];
  const window = bars.slice(startIndex);
  const years = (end.t - start.t) / (365.25 * 86_400_000);
  return {
    startDate: isoDay(start.t),
    startClose: round(start.c, 4),
    endDate: isoDay(end.t),
    endClose: round(end.c, 4),
    returnPct: round(((end.c - start.c) / start.c) * 100),
    annualisedPct: years >= 0.95 ? round((Math.pow(end.c / start.c, 1 / years) - 1) * 100) : null,
    periodHigh: round(Math.max(...window.map((b) => b.h ?? b.c)), 4),
    periodLow: round(Math.min(...window.map((b) => b.l ?? b.c)), 4),
  };
}

export type PerformanceDeps = {
  resolve: (query: string) => Promise<SymbolCandidate[] | null>;
  history: (symbol: string, period: Period) => Promise<History | null>;
};

const defaultDeps: PerformanceDeps = {
  async resolve(query) {
    const result = await symbolResolverTool.execute({ query });
    return result.ok ? (result.data as SymbolResolution).candidates : null;
  },
  async history(symbol, period) {
    const asset = resolveAsset("stock", symbol);
    if (!asset) return null;
    return getHistory(asset, period === "3y" || period === "5y" ? "5y" : "1y");
  },
};

export async function getPerformance(args: PerformanceArgs, deps: PerformanceDeps = defaultDeps): Promise<PerformanceResult> {
  const rows = await Promise.all(
    args.stocks.map(async (query): Promise<PerformanceRow> => {
      const candidates = await deps.resolve(query).catch(() => null);
      const pick = candidates ? pickCandidate(RENAMED_COMPANIES[stripIndianSuffix(query).toLowerCase()] ?? query, candidates) : null;
      if (!pick) return { query, status: "not_found" };
      if ("tied" in pick) return { query, status: "ambiguous", candidates: pick.tied };

      const { symbol, name } = pick.match;
      const history = await deps.history(symbol, args.period).catch(() => null);
      const result = history ? periodReturn(history.candles, args.period) : null;
      if (!result) return { query, status: "no_data", symbol };

      return {
        query,
        status: "ok",
        symbol,
        name,
        currency: history!.currency,
        bars: args.period === "3y" || args.period === "5y" ? "weekly" : "daily",
        ...result,
      };
    })
  );
  return { period: args.period, rows };
}

export const performanceTool: ToolDefinition<PerformanceArgs, PerformanceResult> = {
  name: "get_performance",
  description:
    "Best tool for returns and comparisons. Give 1–5 company names or tickers and a period (1w,1m,3m,6m,ytd,1y,3y,5y); it resolves each name, and returns start/end dates and closes, the % return (already computed — quote it as is), annualised return for 1y+, and the period high/low. Names matching several companies come back 'ambiguous' with candidates: ask the user which one.",
  parameters: {
    type: "object",
    properties: {
      stocks: { type: "array", items: { type: "string" }, description: "Company names or tickers, e.g. ['TCS', 'Infosys']." },
      period: { type: "string", enum: [...PERIODS], description: "Look-back period; ytd = since the start of this calendar year ('this year')." },
    },
    required: ["stocks", "period"],
  },
  argsSchema,
  async execute(args) {
    try {
      const result = await getPerformance(args);
      return result.rows.some((r) => r.status === "ok" || r.status === "ambiguous") ? okResult(result, SOURCE) : failResult(SOURCE);
    } catch {
      return failResult(SOURCE);
    }
  },
};
