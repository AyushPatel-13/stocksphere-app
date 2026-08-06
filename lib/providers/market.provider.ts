import { AssetQuote } from "../types/quote";

import { getYahooQuote } from "../apis/yahoo";
import { getStockQuote as getAlphaQuote } from "../apis/alphavantage";
import { getStockQuote as getTwelveQuote } from "../apis/twelvedata";

import {
  fromYahoo,
  fromAlphaVantage,
  fromTwelveData,
} from "../adapters/quote.adapter";

export async function getMarketQuote(
  symbol: string
): Promise<AssetQuote | null> {
  // 1. Yahoo
  try {
    const yahoo = await getYahooQuote(symbol);

    if (yahoo?.price) {
      return fromYahoo(yahoo);
    }
  } catch {}

  // 2. AlphaVantage
  try {
    const alpha = await getAlphaQuote(symbol);

    if (alpha?.["Global Quote"]) {
      return fromAlphaVantage(alpha);
    }
  } catch {}

  // 3. TwelveData
  try {
    const twelve = await getTwelveQuote(symbol);

    if (twelve?.close) {
      return fromTwelveData(twelve);
    }
  } catch {}

  return null;
}