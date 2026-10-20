import { z } from "zod";
import {
  MARKET_MOVERS_UNIVERSE_LABEL,
  loadMarketMovers,
  type MarketQuotesLookup,
} from "@/lib/services/marketMovers";
import { ToolDefinition, okResult, failResult } from "../types";

// The ranking is Nifty 50 only, and every quote behind it comes from Upstox's
// NSE feed (getNifty50Quotes → getIndianMarketQuotes → Upstox). The label says
// so rather than staying vague: unlike getMarketQuote(), there is no fallback
// chain here that could have answered instead.
const SOURCE = "StockSphere Nifty 50 Market Movers (Upstox NSE quotes)";

// The panel shows three each way; a question phrased "top 5" or "top 10" gets
// what it asked for by passing `limit`.
const DEFAULT_MOVERS = 5;

const argsSchema = z.object({
  limit: z.number().int().min(1).max(10).optional(),
});

export type MarketMoversToolArgs = z.infer<typeof argsSchema>;

/** One ranked mover as the model sees it. */
export interface MarketMoverEntry {
  symbol: string;
  price: number;
  changePercent: number;
}

export interface MarketMoversToolData {
  universe: string;
  totalStocks: number;
  advancing: number;
  declining: number;
  unchanged: number;
  direction: string;
  breadthPercent: number;
  gainers: MarketMoverEntry[];
  losers: MarketMoverEntry[];
}

/**
 * Trim a quote to what identifies a mover. The full AssetQuote carries open,
 * high, low, previous close, volume, currency and a timestamp, none of which a
 * ranking question needs, and all of which would be re-sent to the model on
 * every mover.
 */
function toMoverEntry(quote: {
  symbol: string;
  price: number;
  changePercent?: number;
}): MarketMoverEntry {
  return {
    symbol: quote.symbol,
    price: quote.price,
    changePercent: quote.changePercent ?? 0,
  };
}

/**
 * Factory so tests can inject a fake Nifty 50 quote loader instead of hitting
 * Upstox. Production code uses the default export below.
 */
export function createMarketMoversTool(
  loadQuotes?: MarketQuotesLookup
): ToolDefinition<MarketMoversToolArgs, MarketMoversToolData> {
  return {
    name: "get_market_movers",
    description:
      "Today's Nifty 50 gainers and losers with advancing/declining counts. Use for any market-wide ranking ('top stocks today', 'biggest gainers', 'how is the market'), even when no market is named. Say the ranking is the Nifty 50 — never a whole-market, sector or global ranking — and state only ranks it returns. ok: false means the data is unavailable: say so, don't recall or estimate one.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: `How many top gainers and how many top losers to return (1-10). Defaults to ${DEFAULT_MOVERS}.`,
        },
      },
      required: [],
    },
    argsSchema,
    async execute({ limit }) {
      const perSide = limit ?? DEFAULT_MOVERS;

      try {
        const summary = await loadMarketMovers(loadQuotes, perSide);

        // null means the provider answered with nothing for a universe that is
        // definitely not empty — an outage, not a quiet day. Reporting ok:true
        // with two empty lists would read as "nothing moved today", which is a
        // statement we cannot support, so it is a tool failure instead.
        if (!summary) {
          return failResult(SOURCE);
        }

        const data: MarketMoversToolData = {
          // Spelled out for the model, because "NIFTY_50" is a code the user
          // should never see in an answer. There is no second universe to name,
          // and the panel reads the same summary with three each way.
          universe: MARKET_MOVERS_UNIVERSE_LABEL,
          totalStocks: summary.totalStocks,
          advancing: summary.advancing,
          declining: summary.declining,
          unchanged: summary.unchanged,
          direction: summary.direction,
          breadthPercent: summary.breadthPercent,
          gainers: summary.gainers.map(toMoverEntry),
          losers: summary.losers.map(toMoverEntry),
        };

        return okResult(data, SOURCE);
      } catch {
        // A thrown provider is an unavailable provider, as far as the model is
        // concerned: it must be told there is no data, not handed an exception.
        return failResult(SOURCE);
      }
    },
  };
}

export const marketMoversTool = createMarketMoversTool();
