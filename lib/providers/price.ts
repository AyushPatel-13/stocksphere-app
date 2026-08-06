import { getYahooQuote } from "../apis/yahoo";
import { getStockQuote as getTwelveQuote } from "../apis/twelvedata";

import {
  normalizeYahooPrice,
  normalizeTwelvePrice,
} from "../adapters/price";

export async function fetchPrice(
  symbol: string
) {
  // Yahoo (Primary)
  try {
    const quote = await getYahooQuote(symbol);

    if (quote) {
      console.log("✅ Yahoo");

      return {
        provider: "Yahoo",
        data: normalizeYahooPrice(quote),
      };
    }
  } catch {}

  // TwelveData (Fallback)
  try {
    const quote =
      await getTwelveQuote(symbol);

    if (quote?.close) {
      console.log("✅ TwelveData");

      return {
        provider: "TwelveData",
        data: normalizeTwelvePrice(quote),
      };
    }
  } catch {}

  return null;
}