import { NewsArticle } from "../types/news";

const API_KEY =
  process.env.FINNHUB_API_KEY;

const BASE_URL =
  "https://finnhub.io/api/v1";

export async function getCompanyProfile(
  symbol: string
) {
  // The API key is deliberately never logged. It used to be, on every call.
  const response = await fetch(
    `${BASE_URL}/stock/profile2?symbol=${encodeURIComponent(
      symbol
    )}&token=${API_KEY}`,
    {
      cache: "no-store",
    }
  );

  const data = await response.json();

  console.log(
    "Finnhub Response:",
    data
  );

  return data;
}

/**
 * Company news for the last 7 days.
 *
 * Returns null when Finnhub refused or answered with something other than an
 * article array, so the caller can tell "we were not served" apart from "there
 * is no news". This matters because Finnhub reports a symbol it will not serve
 * as HTTP 403 with a JSON body of {"error":"You don't have access to this
 * resource."} — valid JSON, which response.json() parses happily. Without the
 * status check that error object used to reach the caller as if it were data
 * and ended up rendered as an empty news list.
 */
export async function getCompanyNews(
  symbol: string
): Promise<NewsArticle[] | null> {
  const today = new Date();

  const from = new Date();
  from.setDate(today.getDate() - 7);

  const response = await fetch(
    `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(
      symbol
    )}&from=${from
      .toISOString()
      .split("T")[0]}&to=${today
      .toISOString()
      .split("T")[0]}&token=${process.env.FINNHUB_API_KEY}`,
    {
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    console.error(
      `Finnhub News Error ${response.status}:`,
      errorText
    );

    return null;
  }

  const data = await response.json();

  console.log("Finnhub News:", data);

  return Array.isArray(data) ? data : null;
}