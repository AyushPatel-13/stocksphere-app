import yahooFinance from "yahoo-finance2";

export async function getYahooQuote(
  symbol: string
) {
  try {
    const quote =
      await yahooFinance.quote(symbol);

    return {
      price: quote.regularMarketPrice,
      change: quote.regularMarketChange,
      changePercent:
        quote.regularMarketChangePercent,
      currency: quote.currency,
      name: quote.longName,

      open: quote.regularMarketOpen,
      high: quote.regularMarketDayHigh,
      low: quote.regularMarketDayLow,
      volume: quote.regularMarketVolume,
      previousClose:
        quote.regularMarketPreviousClose,
    };
  } catch (error) {
    console.log(
      "Yahoo Quote Error:",
      error
    );

    return null;
  }
}