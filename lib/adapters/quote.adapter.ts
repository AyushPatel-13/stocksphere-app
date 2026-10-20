import { AssetQuote } from "../types/quote";

/**
 * When the market set this price, as ISO — never the time we fetched it.
 * Accepts epoch milliseconds (Upstox last_trade_time), epoch seconds (Twelve
 * Data timestamp), a Date or a date/ISO string. Undefined when unknown, so the
 * page shows no time rather than a misleading "now".
 */
export function marketTime(value: unknown): string | undefined {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
  const n = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof n === "number" && Number.isFinite(n) && n > 0) {
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    return d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2100 ? d.toISOString() : undefined;
  }
  if (typeof n === "string" && n.trim()) {
    const t = Date.parse(n);
    return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
  }
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw provider JSON; each field is read and converted below
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
    lastUpdated: marketTime(data.regularMarketTime),
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw provider JSON; each field is read and converted below
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
    lastUpdated: marketTime(quote?.["07. latest trading day"]),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw provider JSON; each field is read and converted below
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
    lastUpdated: marketTime(data.timestamp),
  };
}

export function fromUpstox(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw provider JSON; each field is read and converted below
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
    lastUpdated: marketTime(quote.last_trade_time),
  };
}