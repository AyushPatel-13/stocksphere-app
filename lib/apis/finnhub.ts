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
/** One article from Finnhub's general market news. Fields are unvalidated. */
export interface FinnhubMarketNewsItem {
  id?: unknown;
  headline?: unknown;
  summary?: unknown;
  url?: unknown;
  source?: unknown;
  datetime?: unknown;
  related?: unknown;
}

/**
 * General (US) market news — free on Finnhub's free plan.
 *
 * Null when Finnhub refused or answered with something other than an array,
 * same rule as getCompanyNews(): "not served" is not "no news".
 */
export async function getMarketNews(): Promise<FinnhubMarketNewsItem[] | null> {
  try {
    const response = await fetch(
      `${BASE_URL}/news?category=general&token=${API_KEY}`,
      { cache: "no-store", signal: AbortSignal.timeout(8_000) }
    );

    if (!response.ok) {
      console.error(`Finnhub Market News Error ${response.status}`);
      return null;
    }

    const data = await response.json();
    return Array.isArray(data) ? data : null;
  } catch (error) {
    console.error("Finnhub Market News Error:", error instanceof Error ? error.message : error);
    return null;
  }
}


/** One US listing from Finnhub's symbol search. */
export interface FinnhubSymbolMatch {
  symbol: string;
  description: string;
  type: string;
}

/**
 * US stocks and ETFs matching a name or ticker (Finnhub /search, free plan).
 *
 * Only US listings are kept: exchange=US, and symbols carrying a "." or ":"
 * (foreign or class-share listings) are dropped, as are types other than
 * common stock, ADRs and exchange-traded products. Null when Finnhub refused
 * or answered with an unexpected shape — "couldn't search" is not "no match".
 */
export async function searchFinnhubSymbols(
  query: string,
  limit = 10
): Promise<FinnhubSymbolMatch[] | null> {
  const q = query.trim();
  if (!q) return [];
  if (!API_KEY) return null;

  try {
    const params = new URLSearchParams({ q, exchange: "US", token: API_KEY });
    const response = await fetch(`${BASE_URL}/search?${params.toString()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });

    if (!response.ok) {
      console.error(`Finnhub Search Error ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!Array.isArray(data?.result)) return null;

    const allowed = new Set(["Common Stock", "ADR", "ETP"]);
    const matches: FinnhubSymbolMatch[] = [];

    for (const row of data.result as Record<string, unknown>[]) {
      const symbol = typeof row?.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
      const type = typeof row?.type === "string" ? row.type : "";
      if (!symbol || /[.:]/.test(symbol) || !allowed.has(type)) continue;

      matches.push({
        symbol,
        description: typeof row.description === "string" ? row.description.trim() : symbol,
        type,
      });
      if (matches.length >= limit) break;
    }

    return matches;
  } catch (error) {
    console.error("Finnhub Search Error:", error instanceof Error ? error.message : error);
    return null;
  }
}
