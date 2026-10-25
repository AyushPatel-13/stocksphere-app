import { createWindowLimiter } from "@/lib/utils/rateLimit";

const API_KEY = process.env.TWELVE_DATA_API_KEY;

/**
 * The free plan allows 8 credits a minute. One is kept in reserve, and a call
 * over budget is never sent: it answers with Twelve Data's own credits-exhausted
 * envelope, which every caller already treats as "the service declined", so the
 * chain moves on to the next provider instead of burning the account.
 */
export const twelveDataBudget = createWindowLimiter({ limit: 7, windowMs: 60_000 });

const OVER_BUDGET = {
  status: "error",
  code: 429,
  message: "StockSphere's Twelve Data budget for this minute is used up.",
} as const;

export async function getStockQuote(symbol: string) {
  if (!twelveDataBudget.take()) return OVER_BUDGET;

  // The API key is deliberately never logged. It used to be, on every call.
  const response = await fetch(
    `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(
      symbol
    )}&apikey=${API_KEY}`,
    {
      cache: "no-store",
    }
  );

  const data = await response.json();

  console.log("Twelve Response:", data);

  return data;
}

export async function getHistoricalData(symbol: string) {
  if (!twelveDataBudget.take()) return OVER_BUDGET;

  const response = await fetch(
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
      symbol
    )}&interval=1day&outputsize=365&apikey=${API_KEY}`,
    {
      cache: "no-store",
    }
  );

  const data = await response.json();

  console.log("Historical Response:", data);

  return data;
}
