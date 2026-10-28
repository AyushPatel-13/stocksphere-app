import { getMarketQuote } from "../providers/market.provider";
import { toStockPrice } from "../providers/price";
import { isIndianEquitySymbol } from "../data/instruments/india";
import { StockPrice } from "../types/price";

/**
 * The stock page header's price. It comes from getMarketQuote, the same
 * source as /api/market, the charts and alerts (Upstox for Indian listings,
 * Yahoo first elsewhere), so the header and the chart beneath it agree.
 * It used to come from fetchPrice, which priced US stocks from Twelve Data:
 * MSFT read 528.22 in the header and 528.14 on the chart.
 */
export async function getPrice(
  symbol: string,
  lookup: typeof getMarketQuote = getMarketQuote
): Promise<StockPrice | null> {
  const quote = await lookup(symbol);
  if (!quote) return null;
  // Not every provider reports a currency; the listing decides it then.
  const indian = /.(NS|BO|BSE)$/i.test(symbol) || isIndianEquitySymbol(symbol);
  return toStockPrice({ ...quote, currency: quote.currency ?? (indian ? "INR" : "USD") });
}
