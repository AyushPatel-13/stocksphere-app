import { AssetQuote } from "../types/quote";

export function fromYahoo(data: any): AssetQuote {
  const price = Number(data.price ?? 0);
  const previousClose = Number(data.previousClose ?? 0);

  const change =
    data.change != null
      ? Number(data.change)
      : price - previousClose;

  const changePercent =
    data.changePercent != null
      ? Number(data.changePercent)
      : previousClose
        ? (change / previousClose) * 100
        : 0;

  return {
    symbol: data.symbol ?? "",
    price,
    change,
    changePercent,
    open: Number(data.open ?? 0),
    high: Number(data.high ?? 0),
    low: Number(data.low ?? 0),
    previousClose,
    volume: Number(data.volume ?? 0),
    currency: data.currency ?? "USD",
    lastUpdated: new Date().toISOString(),
  };
}

export function fromAlphaVantage(data: any): AssetQuote {
  const quote = data?.["Global Quote"];

  const price = Number(quote?.["05. price"] ?? 0);
  const change = Number(quote?.["09. change"] ?? 0);

  const changePercent = Number(
    String(quote?.["10. change percent"] ?? "0").replace("%", "")
  );

  const previousClose =
    price && change
      ? price - change
      : undefined;

  return {
    symbol: quote?.["01. symbol"] ?? "",
    price,
    change,
    changePercent,
    previousClose,
    lastUpdated: new Date().toISOString(),
  };
}

export function fromTwelveData(data: any): AssetQuote {
  const price = Number(data.close ?? 0);
  const previousClose = Number(data.previous_close ?? 0);

  const change =
    previousClose
      ? price - previousClose
      : 0;

  const changePercent =
    previousClose
      ? (change / previousClose) * 100
      : 0;

  return {
    symbol: data.symbol ?? "",
    price,
    change,
    changePercent,
    open: Number(data.open ?? 0),
    high: Number(data.high ?? 0),
    low: Number(data.low ?? 0),
    previousClose,
    volume: Number(data.volume ?? 0),
    currency: data.currency ?? "USD",
    lastUpdated: new Date().toISOString(),
  };
}

export function fromUpstox(
  data: any,
  instrumentKey: string
): AssetQuote {
  const quotes = data?.data;

  const responseKey = Object.keys(quotes ?? {}).find(
    (key) =>
      quotes[key]?.instrument_token === instrumentKey
  );

  const quote = responseKey
    ? quotes[responseKey]
    : undefined;

  if (!quote) {
    throw new Error(
      `Upstox quote not found for ${instrumentKey}`
    );
  }

  const price = Number(
    quote.last_price ?? 0
  );

  const previousClose = Number(
    quote.prev_close_price ?? 0
  );

  const change = Number(
    quote.net_change ?? 0
  );

  const changePercent = previousClose
    ? (change / previousClose) * 100
    : 0;

  return {
    symbol: quote.symbol ?? "",
    price,
    change,
    changePercent,
    open: Number(
      quote.ohlc?.open ?? 0
    ),
    high: Number(
      quote.ohlc?.high ?? 0
    ),
    low: Number(
      quote.ohlc?.low ?? 0
    ),
    previousClose,
    volume: Number(
      quote.volume ?? 0
    ),
    currency: "INR",
    lastUpdated: new Date().toISOString(),
  };
}