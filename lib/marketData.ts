import { getYahooQuote } from "./apis/yahoo";
import { getStockQuote as getAlphaQuote } from "./apis/alphavantage";
import { getStockQuote as getTwelveQuote } from "./apis/twelvedata";

export async function getMarketPrice(
  symbol: string
) {
  try {
    const alpha =
      await getAlphaQuote(symbol);

    const alphaPrice =
      alpha?.["Global Quote"]?.[
      "05. price"
      ];

    console.log(alpha);

    if (alphaPrice) {
      console.log(
        "Alpha:",
        alphaPrice
      );

      return Number(alphaPrice);
    }
  } catch { }

  try {
    const twelve =
      await getTwelveQuote(symbol);

    console.log(twelve);

    if (twelve?.close) {
      console.log(
        "Twelve:",
        twelve.close
      );

      return Number(
        twelve.close
      );
    }
  } catch { }

  return null;
}