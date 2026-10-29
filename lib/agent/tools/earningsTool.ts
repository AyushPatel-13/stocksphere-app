import { z } from "zod";

import { getEarningsCalendar, type EarningsEvent } from "@/lib/services/earningsCalendar";
import { ToolDefinition, failResult, okResult } from "../types";

/**
 * Upcoming earnings dates (US listings, Finnhub's free calendar — the same
 * data as the Events page). Indian results dates aren't available from
 * StockSphere's sources, and the tool says so instead of returning nothing.
 */

const SOURCE = "Finnhub earnings calendar (US listings)";

const argsSchema = z.object({
  symbols: z.array(z.string().trim().min(1).max(12)).max(10).optional(),
  days: z.number().int().min(1).max(30).optional(),
});

export type EarningsToolArgs = z.infer<typeof argsSchema>;

export type EarningsToolResult = {
  from: string;
  to: string;
  coverage: string;
  events: Pick<EarningsEvent, "symbol" | "date" | "hour" | "epsEstimate" | "revenueEstimate" | "quarter" | "year">[];
  notFound: string[];
  /** Total events in the window when no symbols were given (only the first 25 are listed). */
  totalInWindow: number;
};

export async function runEarningsTool(
  args: EarningsToolArgs,
  load: typeof getEarningsCalendar = getEarningsCalendar,
  now: number = Date.now()
): Promise<EarningsToolResult | null> {
  // A named company is looked up over the whole window: with the 14-day
  // market-wide default, "When does Nvidia report?" missed a date 19 days out.
  const days = args.days ?? ((args.symbols?.length ?? 0) > 0 ? 30 : 14);
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const from = iso(now);
  const to = iso(now + days * 86_400_000);
  const wanted = Array.from(new Set((args.symbols ?? []).map((s) => s.toUpperCase().replace(/\.NS$|\.BSE?$/, ""))));

  // Specific companies are asked for one by one: the market-wide calendar is
  // capped at 1,500 events and can leave out any given company.
  let all: EarningsEvent[];
  if (wanted.length > 0) {
    const perSymbol = await Promise.all(wanted.map((symbol) => load(from, to, undefined, undefined, symbol)));
    if (perSymbol.every((r) => r === null)) return null;
    all = perSymbol.flatMap((r) => r ?? []);
  } else {
    const window = await load(from, to);
    if (!window) return null;
    all = window;
  }

  const picked = wanted.length > 0 ? all.filter((e) => wanted.includes(e.symbol)) : all.filter((e) => e.epsEstimate !== null).slice(0, 25);

  return {
    from,
    to,
    coverage: "US-listed companies only; Indian results dates are not available from StockSphere's data sources.",
    events: picked.map(({ symbol, date, hour, epsEstimate, revenueEstimate, quarter, year }) => ({ symbol, date, hour, epsEstimate, revenueEstimate, quarter, year })),
    notFound: wanted.filter((s) => !picked.some((e) => e.symbol === s)),
    totalInWindow: all.length,
  };
}

export const earningsTool: ToolDefinition<EarningsToolArgs, EarningsToolResult> = {
  name: "get_earnings_calendar",
  description:
    "Upcoming earnings report dates for US-listed companies over the next 1–30 days (default 30 for named tickers, 14 otherwise), with consensus EPS and revenue estimates. Pass tickers to check specific companies. Indian results dates are not covered — say so if asked.",
  parameters: {
    type: "object",
    properties: {
      symbols: { type: "array", items: { type: "string" }, description: "US tickers, e.g. ['AAPL','MSFT']. Omit for the busiest upcoming reports." },
      days: { type: "integer", description: "Days ahead, 1–30 (default 30 when tickers are given, else 14). Say the window you searched." },
    },
    required: [],
  },
  argsSchema,
  async execute(args) {
    try {
      const result = await runEarningsTool(args);
      return result ? okResult(result, SOURCE) : failResult(SOURCE);
    } catch {
      return failResult(SOURCE);
    }
  },
};
