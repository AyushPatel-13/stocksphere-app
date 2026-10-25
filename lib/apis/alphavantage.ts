import { createWindowLimiter } from "@/lib/utils/rateLimit";

const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;

/**
 * The free plan allows 25 requests a day. One is kept in reserve, and a call
 * over budget is never sent: it answers with Alpha Vantage's own "Information"
 * envelope, which callers already treat as "the service declined".
 */
export const alphaVantageBudget = createWindowLimiter({ limit: 24, windowMs: 24 * 60 * 60_000 });

const OVER_BUDGET = { Information: "StockSphere's Alpha Vantage budget for today is used up." } as const;

export async function getStockQuote(symbol: string) {
  if (!alphaVantageBudget.take()) return OVER_BUDGET;

  try {
    const response = await fetch(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(
        symbol
      )}&apikey=${API_KEY}`,
      {
        cache: "no-store",
      }
    );

    const data = await response.json();

    console.log(`Alpha Response [${symbol}]:`, data);

    return data;
  } catch (error) {
    console.error(`Alpha Vantage Error [${symbol}]:`, error);

    return null;
  }
}

export async function getCompanyOverview(symbol: string) {
  if (!alphaVantageBudget.take()) return OVER_BUDGET;

  try {
    const response = await fetch(
      `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(
        symbol
      )}&apikey=${API_KEY}`,
      {
        cache: "no-store",
      }
    );

    const data = await response.json();

    console.log(`Alpha Overview [${symbol}]:`, data);

    return data;
  } catch (error) {
    console.error(`Alpha Overview Error [${symbol}]:`, error);

    return null;
  }
}