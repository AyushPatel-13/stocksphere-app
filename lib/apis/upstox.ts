const ACCESS_TOKEN = process.env.UPSTOX_ACCESS_TOKEN;

export async function getUpstoxQuotes(
  instrumentKeys: string[]
) {
  if (!ACCESS_TOKEN) {
    throw new Error(
      "UPSTOX_ACCESS_TOKEN is missing from environment variables"
    );
  }

  const instruments = instrumentKeys.join(",");

  try {
    const response = await fetch(
      `https://api.upstox.com/v3/market-quote/quotes?instrument_key=${encodeURIComponent(
        instruments
      )}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        `Upstox API Error ${response.status}:`,
        errorText
      );

      return null;
    }

    const data = await response.json();

    console.log("Upstox Response:", data);

    return data;
  } catch (error) {
    console.error("Upstox Request Error:", error);

    return null;
  }
}

export async function searchUpstoxEquity(
  symbol: string
) {
  if (!ACCESS_TOKEN) {
    throw new Error(
      "UPSTOX_ACCESS_TOKEN is missing from environment variables"
    );
  }

  try {
    const params = new URLSearchParams({
      query: symbol,
      exchanges: "NSE",
      segments: "EQ",
      instrument_types: "EQ",
      page_number: "1",
      records: "30",
    });

    const response = await fetch(
      `https://api.upstox.com/v2/instruments/search?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        `Upstox Instrument Search Error ${response.status}:`,
        errorText
      );

      return null;
    }

    const data = await response.json();

    const instrument = data?.data?.find(
      (item: {
        segment?: string;
        instrument_type?: string;
        trading_symbol?: string;
        instrument_key?: string;
      }) =>
        item.segment === "NSE_EQ" &&
        item.instrument_type === "EQ" &&
        item.trading_symbol?.toUpperCase() ===
          symbol.toUpperCase()
    );

    return instrument ?? null;
  } catch (error) {
    console.error(
      `Upstox Instrument Search Error [${symbol}]:`,
      error
    );

    return null;
  }
}

/**
 * A single NSE equity returned by the Upstox instrument search.
 *
 * Only NSE_EQ / EQ rows that have both a trading symbol and an instrument key
 * are ever returned by searchUpstoxEquityCandidates().
 */
export interface UpstoxEquityCandidate {
  trading_symbol: string;
  instrument_key: string;
  segment: string;
  instrument_type: string;
  name?: string;
  short_name?: string;
  isin?: string;
  exchange?: string;
}

/**
 * Free-text NSE equity search that returns ALL matching candidates.
 *
 * searchUpstoxEquity() above is an exact-symbol lookup used by the quote path
 * and is intentionally left unchanged. This function uses the same endpoint,
 * authentication, and NSE/EQ filters, but returns the candidate list instead
 * of discarding everything except one exact match.
 *
 * Returns:
 *  - an array (possibly empty) when Upstox answered successfully
 *  - null when the request failed or the response was not in the expected shape
 * Throws if UPSTOX_ACCESS_TOKEN is missing (same convention as
 * searchUpstoxEquity).
 */
export async function searchUpstoxEquityCandidates(
  query: string,
  limit = 30
): Promise<UpstoxEquityCandidate[] | null> {
  if (!ACCESS_TOKEN) {
    throw new Error(
      "UPSTOX_ACCESS_TOKEN is missing from environment variables"
    );
  }

  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [];
  }

  // Upstox allows 1-30 records per page.
  const records = Number.isFinite(limit)
    ? Math.min(Math.max(Math.trunc(limit), 1), 30)
    : 30;

  try {
    const params = new URLSearchParams({
      query: trimmedQuery,
      exchanges: "NSE",
      segments: "EQ",
      instrument_types: "EQ",
      page_number: "1",
      records: String(records),
    });

    const response = await fetch(
      `https://api.upstox.com/v2/instruments/search?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        `Upstox Instrument Candidate Search Error ${response.status}:`,
        errorText
      );

      return null;
    }

    const data = await response.json();
    const items: unknown = data?.data;

    // Not the documented shape: report "unavailable", not "no matches".
    if (!Array.isArray(items)) {
      return null;
    }

    const candidates: UpstoxEquityCandidate[] = [];

    for (const item of items) {
      if (!item || typeof item !== "object") continue;

      const row = item as Record<string, unknown>;

      if (
        row.segment !== "NSE_EQ" ||
        row.instrument_type !== "EQ" ||
        typeof row.trading_symbol !== "string" ||
        !row.trading_symbol.trim() ||
        typeof row.instrument_key !== "string" ||
        !row.instrument_key.trim()
      ) {
        continue;
      }

      candidates.push({
        trading_symbol: row.trading_symbol.trim(),
        instrument_key: row.instrument_key,
        segment: row.segment,
        instrument_type: row.instrument_type,
        ...(typeof row.name === "string" && { name: row.name }),
        ...(typeof row.short_name === "string" && {
          short_name: row.short_name,
        }),
        ...(typeof row.isin === "string" && { isin: row.isin }),
        ...(typeof row.exchange === "string" && {
          exchange: row.exchange,
        }),
      });
    }

    return candidates;
  } catch (error) {
    console.error(
      `Upstox Instrument Candidate Search Error [${query}]:`,
      error
    );

    return null;
  }
}
