import yahooFinance from "yahoo-finance2";

type YahooRawQuote = Awaited<
  ReturnType<typeof yahooFinance.quote>
>;

function toQuote(quote: YahooRawQuote) {
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
}

export type YahooQuote = ReturnType<typeof toQuote>;

/**
 * Several quotes in ONE Yahoo request, keyed by the symbol asked for.
 *
 * Yahoo rate-limits per IP (HTTP 429) and does so readily, so eight parallel
 * single-symbol calls for the global indices were eight chances to be refused.
 * Returns null when the request failed; a symbol Yahoo did not return is simply
 * absent from the map.
 */
export async function getYahooQuotes(
  symbols: string[]
): Promise<Record<string, YahooQuote> | null> {
  if (symbols.length === 0) return {};

  try {
    const quotes = (await yahooFinance.quote(
      symbols
    )) as unknown as YahooRawQuote[];

    return Object.fromEntries(
      quotes.map((quote) => [quote.symbol, toQuote(quote)])
    );
  } catch (error) {
    console.log(
      "Yahoo Batch Quote Error:",
      error instanceof Error ? error.message : error
    );

    return null;
  }
}

export async function getYahooQuote(
  symbol: string
) {
  try {
    const quote =
      await yahooFinance.quote(symbol);

    return toQuote(quote);
  } catch (error) {
    console.log(
      "Yahoo Quote Error:",
      error
    );

    return null;
  }
}