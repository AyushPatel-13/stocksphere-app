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

/**
 * Normalize an Alpha Vantage GLOBAL_QUOTE response.
 *
 * Returns null when the response carries no price, rather than a quote of zero.
 *
 * Alpha Vantage answers a symbol it cannot resolve with `{"Global Quote": {}}`
 * — a valid envelope with nothing in it. `Number(quote?.["05. price"] ?? 0)`
 * turned that absence into a perfectly well-formed price of 0, which callers
 * then reported as a real quote for a security nobody could price. Absent and
 * zero are different facts and are kept different here.
 *
 * A price the provider genuinely reports as "0" is still returned as 0; only a
 * missing or unparseable one is null.
 */
export function fromAlphaVantage(
  data: any
): AssetQuote | null {
  const quote = data?.["Global Quote"];

  const rawPrice = quote?.["05. price"];

  if (
    rawPrice == null ||
    String(rawPrice).trim() === ""
  ) {
    return null;
  }

  const price = Number(rawPrice);

  if (!Number.isFinite(price)) {
    return null;
  }

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

  // Absent and zero are different facts, here as in fromAlphaVantage(): a
  // provider reporting a price of 0 has answered, but a response carrying no
  // last_price has not. Defaulting it to 0 put a ₹0.00 price on the stock page
  // and a ₹0 price in front of the Agent's price tool.
  //
  // This throws for the same reason the missing entry above does — that is the
  // signal this function already documents, and every caller already handles it:
  // getIndianMarketQuote() returns null, the bulk path drops the quote, and
  // classifyUpstoxPrice() reports "failure".
  const rawPrice = quote.last_price;

  if (
    rawPrice === undefined ||
    rawPrice === null ||
    String(rawPrice).trim() === ""
  ) {
    throw new Error(
      `Upstox quote has no last_price for ${instrumentKey}`
    );
  }

  const price = Number(rawPrice);

  if (!Number.isFinite(price)) {
    throw new Error(
      `Upstox quote has an unreadable last_price for ${instrumentKey}`
    );
  }

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