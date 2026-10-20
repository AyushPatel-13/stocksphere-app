import { z } from "zod";

import { EMPTY_CRITERIA, PRESETS, US_LARGE_CAPS, applyScreen, sortScreen, type PresetId } from "@/lib/analytics/screener";
import { NIFTY_50_SYMBOLS } from "@/lib/data/instruments/india";
import { getWatchlistRows } from "@/lib/services/watchlistRows";
import { ToolDefinition, failResult, okResult } from "../types";

/**
 * Runs one of the screener's presets over the NIFTY 50 and/or 20 US large
 * caps and returns the matches with the reasons each one matched — the same
 * rules as the /screener page.
 */

const SOURCE = "StockSphere Screener (Yahoo Finance prices, may be delayed)";
const SCREENS = ["gainers", "losers", "near_high", "near_low", "big_movers"] as const;

const argsSchema = z.object({
  screen: z.enum(SCREENS),
  market: z.enum(["india", "us", "all"]).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

export type ScreenerToolArgs = z.infer<typeof argsSchema>;

export type ScreenerToolResult = {
  screen: (typeof SCREENS)[number];
  universe: string;
  matches: { symbol: string; price: number | null; currency: string | null; changePercent: number | null; position52wPct: number | null; reasons: string[] }[];
  total: number;
  asOf: string | null;
};

export async function runScreenTool(args: ScreenerToolArgs, load: typeof getWatchlistRows = getWatchlistRows): Promise<ScreenerToolResult | null> {
  const preset = PRESETS.find((p) => p.id === (args.screen as PresetId))!;
  const market = args.market ?? "india";
  const limit = args.limit ?? 10;
  const markets: ("india" | "us")[] = market === "all" ? ["india", "us"] : [market];

  const rows = (
    await Promise.all(
      markets.map(async (market) => (await load(market === "india" ? [...NIFTY_50_SYMBOLS] : US_LARGE_CAPS)).map((row) => ({ ...row, market })))
    )
  ).flat();

  if (!rows.some((row) => row.price !== null)) return null;

  const matched = sortScreen(applyScreen(rows, { ...EMPTY_CRITERIA, ...preset.criteria }, args.screen === "big_movers"), preset.sort.key, preset.sort.desc);
  const asOf = rows.map((r) => r.asOf).filter((t): t is string => Boolean(t)).sort().at(-1) ?? null;

  return {
    screen: args.screen,
    universe: markets.map((m) => (m === "india" ? "NIFTY 50" : "20 US large caps")).join(" + "),
    matches: matched.slice(0, limit).map((row) => ({
      symbol: row.symbol,
      price: row.price,
      currency: row.currency,
      changePercent: row.changePercent === null ? null : Math.round(row.changePercent * 100) / 100,
      position52wPct: row.position52w === null ? null : Math.round(row.position52w),
      reasons: row.reasons,
    })),
    total: matched.length,
    asOf,
  };
}

export const screenerTool: ToolDefinition<ScreenerToolArgs, ScreenerToolResult> = {
  name: "run_screen",
  description:
    "Screen the NIFTY 50 (market 'india'), 20 US large caps ('us') or both ('all') with a preset: gainers, losers, near_high (within 5% of the 52-week high), near_low (within 5% of the 52-week low), big_movers (moved 3%+ today). Returns matches with the reason each matched and an asOf time. Use for 'which stocks are near their 52-week high', 'biggest movers today' style questions. Report only what it returns and name the universe.",
  parameters: {
    type: "object",
    properties: {
      screen: { type: "string", enum: [...SCREENS], description: "Which preset screen to run." },
      market: { type: "string", enum: ["india", "us", "all"], description: "Universe (default india = NIFTY 50)." },
      limit: { type: "integer", description: "Max matches to return, 1–20 (default 10)." },
    },
    required: ["screen"],
  },
  argsSchema,
  async execute(args) {
    try {
      const result = await runScreenTool(args);
      return result ? okResult(result, SOURCE) : failResult(SOURCE);
    } catch {
      return failResult(SOURCE);
    }
  },
};
