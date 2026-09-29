import { z } from "zod";
import { getMarketQuote } from "@/lib/providers/market.provider";
import { AssetQuote } from "@/lib/types/quote";
import { ToolDefinition, okResult, failResult } from "../types";

// getMarketQuote() is StockSphere's universal quote path: it routes Indian
// symbols (.NS/.BSE) to Upstox and everything else through the
// TwelveData -> AlphaVantage -> Yahoo fallback chain, but it does not
// surface which of those actually answered. This label stays generic
// rather than claiming a specific provider.
const SOURCE = "StockSphere Market Quote Service";

const argsSchema = z.object({
  symbol: z.string().trim().min(1).max(20),
});

export type PriceToolArgs = z.infer<typeof argsSchema>;

// Exported for direct unit testing of the validity rule without needing to
// mock the network-backed getMarketQuote() service.
export function isValidPrice(quote: AssetQuote | null | undefined): quote is AssetQuote {
  return !!quote && typeof quote.price === "number" && !Number.isNaN(quote.price);
}

export const priceTool: ToolDefinition<PriceToolArgs, AssetQuote> = {
  name: "get_price",
  description:
    "Get the current/most recent quote for a stock ticker symbol: price, change, change percent, open, high, low, previous close, volume, currency. Covers Indian symbols (e.g. TCS.NS, INFY.NS, via Upstox) as well as US/global symbols. Use this for 'current price', 'how is <symbol> doing today' type questions.",
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
      const quote = await getMarketQuote(symbol);
      if (!isValidPrice(quote)) {
        return failResult(SOURCE);
      }
      return okResult(quote, SOURCE);
    } catch {
      return failResult(SOURCE);
    }
  },
};
