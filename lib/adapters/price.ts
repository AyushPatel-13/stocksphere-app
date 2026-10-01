import { StockPrice } from "../types/price";
import { fromUpstox } from "./quote.adapter";

export function normalizeFinnhubPrice(data: any): StockPrice {
  return {
    price: data.c,
    change: data.d,
    changePercent: data.dp,
    open: data.o,
    high: data.h,
    low: data.l,
    previousClose: data.pc,
    volume: 0,
    currency: "USD",
  };
}

export function normalizeYahooPrice(data: any): StockPrice {
  return {
    price: data.price,
    change: data.change,
    changePercent: data.changePercent,
    open: data.open,
    high: data.high,
    low: data.low,
    previousClose: data.previousClose,
    volume: data.volume,
    currency: data.currency,
  };
}


export function normalizeTwelvePrice(data: any): StockPrice {
  return {
    price: Number(data.close),
    change: Number(data.change),
    changePercent: Number(data.percent_change),
    open: Number(data.open),
    high: Number(data.high),
    low: Number(data.low),
    previousClose: Number(data.previous_close),
    volume: Number(data.volume),
    currency: data.currency,
  };
}

/**
 * Upstox quote -> StockPrice.
 *
 * The field extraction is NOT repeated here: fromUpstox() in quote.adapter.ts is
 * already the single place that knows how to find a quote inside Upstox's
 * response envelope and which fields carry which numbers, and it is what the
 * Indian quote path in lib/providers/market.provider.ts uses. This only
 * reshapes its AssetQuote into the StockPrice that the price path and
 * app/stock/[symbol]/page.tsx expect, so the two Indian paths cannot drift.
 *
 * fromUpstox() throws when the response holds no entry for the instrument key.
 * That is deliberate and is relied on by classifyUpstoxPrice() in
 * lib/providers/price.ts, which uses it to tell a legitimate empty result from
 * an unreadable one.
 */
export function normalizeUpstoxPrice(
  data: unknown,
  instrumentKey: string
): StockPrice {
  const quote = fromUpstox(data, instrumentKey);

  return {
    price: quote.price,
    change: quote.change ?? 0,
    changePercent: quote.changePercent ?? 0,
    open: quote.open ?? 0,
    high: quote.high ?? 0,
    low: quote.low ?? 0,
    previousClose: quote.previousClose ?? 0,
    volume: quote.volume ?? 0,
    currency: quote.currency ?? "INR",
  };
}