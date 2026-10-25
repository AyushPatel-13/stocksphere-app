import { upstoxFetch } from "./upstoxGate";
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
    const response = await upstoxFetch(
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

    return data;
  } catch (error) {
    console.error("Upstox Request Error:", error);

    return null;
  }
}

/**
 * Instrument keys don't change, so a successful lookup is reused for 12 hours
 * and concurrent lookups of one symbol share a request. At most
 * SEARCH_CONCURRENCY searches run at once: a page that resolves the whole
 * NIFTY 50 used to fire 50 at the same moment and get rate-limited.
 * Misses and failures are never cached.
 */
const INSTRUMENT_TTL_MS = 12 * 60 * 60_000;
const SEARCH_CONCURRENCY = 8;
type EquityInstrument = Awaited<ReturnType<typeof searchUpstoxEquityUncached>>;
const instrumentCache = new Map<string, { at: number; value: EquityInstrument }>();
const instrumentInFlight = new Map<string, Promise<EquityInstrument>>();
let activeSearches = 0;
const searchQueue: (() => void)[] = [];

async function withSearchSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeSearches >= SEARCH_CONCURRENCY) {
    await new Promise<void>((resolve) => searchQueue.push(resolve));
  }
  activeSearches++;
  try {
    return await task();
  } finally {
    activeSearches--;
    searchQueue.shift()?.();
  }
}

export async function searchUpstoxEquity(symbol: string): Promise<EquityInstrument> {
  if (!ACCESS_TOKEN) {
    throw new Error(
      "UPSTOX_ACCESS_TOKEN is missing from environment variables"
    );
  }

  const key = symbol.trim().toUpperCase();
  const hit = instrumentCache.get(key);
  if (hit && Date.now() - hit.at < INSTRUMENT_TTL_MS) return hit.value;

  let pending = instrumentInFlight.get(key);
  if (!pending) {
    pending = withSearchSlot(() => searchUpstoxEquityUncached(symbol)).finally(() => {
      instrumentInFlight.delete(key);
    });
    instrumentInFlight.set(key, pending);
  }

  const value = await pending;
  if (value) instrumentCache.set(key, { at: Date.now(), value });
  return value;
}

async function searchUpstoxEquityUncached(
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

    const response = await upstoxFetch(
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

    const response = await upstoxFetch(
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

export async function searchUpstoxIndex(
  query: string,
  exchange: "NSE" | "BSE" = "NSE"
) {
  if (!ACCESS_TOKEN) {
    throw new Error(
      "UPSTOX_ACCESS_TOKEN is missing from environment variables"
    );
  }

  try {
    const params = new URLSearchParams({
      query,
      exchanges: exchange,
      segments: "INDEX",
      instrument_types: "INDEX",
      page_number: "1",
      records: "30",
    });

    const response = await upstoxFetch(
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
        `Upstox Index Search Error ${response.status}:`,
        errorText
      );

      return null;
    }

    const data = await response.json();

    const instrument = data?.data?.find(
      (item: {
        segment?: string;
        instrument_type?: string;
        instrument_key?: string;
        trading_symbol?: string;
      }) =>
        item.segment === `${exchange}_INDEX` &&
        item.instrument_type === "INDEX" &&
        item.instrument_key &&
        item.trading_symbol
    );

    return instrument ?? null;
  } catch (error) {
    console.error(
      `Upstox Index Search Error [${query}]:`,
      error
    );

    return null;
  }
}

/* ------------------------------------------------------------ IPOs */

/**
 * Upstox IPO API (official, documented):
 *   GET /v2/ipos?status=&issue_type=&page_number=&records=   list (records ≤ 30)
 *   GET /v2/ipos/{id}                                        one IPO's details
 * https://upstox.com/developer/api-documentation/get-ipos/
 * https://upstox.com/developer/api-documentation/get-ipo-details/
 *
 * Both need the same Bearer token as the other Upstox calls. Every failure is
 * classified so the page can say what went wrong (token expired, rate limit,
 * timeout, …) instead of a generic error. The token never leaves the server.
 */
export type UpstoxIpoStatus = "open" | "upcoming" | "closed" | "listed";

export type UpstoxErrorCode = "not_configured" | "auth" | "rate_limited" | "timeout" | "not_found" | "provider";

export type UpstoxResult = { ok: true; body: unknown } | { ok: false; code: UpstoxErrorCode; status: number | null };

const IPO_TIMEOUT_MS = 8_000;

async function upstoxIpoRequest(path: string): Promise<UpstoxResult> {
  if (!ACCESS_TOKEN) return { ok: false, code: "not_configured", status: null };

  try {
    const response = await upstoxFetch(`https://api.upstox.com${path}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${ACCESS_TOKEN}` },
      cache: "no-store",
      signal: AbortSignal.timeout(IPO_TIMEOUT_MS),
    });
    const body: unknown = await response.json().catch(() => null);

    if (response.ok) return { ok: true, body };
    // UDAPI100050 = invalid or expired token (verified: 401).
    if (response.status === 401 || response.status === 403) return { ok: false, code: "auth", status: response.status };
    if (response.status === 429) return { ok: false, code: "rate_limited", status: 429 };
    // UDAPI100500 = no IPO for that id (verified: 400).
    const codes = (body as { errors?: { errorCode?: string }[] } | null)?.errors?.map((e) => e.errorCode) ?? [];
    if (codes.includes("UDAPI100500")) return { ok: false, code: "not_found", status: response.status };
    console.error(`Upstox IPO ${response.status}: ${path}`);
    return { ok: false, code: "provider", status: response.status };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    if (!timedOut) console.error(`Upstox IPO error: ${path}`, error instanceof Error ? error.message : error);
    return { ok: false, code: timedOut ? "timeout" : "provider", status: null };
  }
}

export function getUpstoxIpos(params: {
  status: UpstoxIpoStatus;
  issueType?: "regular" | "sme";
  pageNumber?: number;
  records?: number;
}): Promise<UpstoxResult> {
  const query = new URLSearchParams({
    status: params.status,
    page_number: String(Math.max(1, Math.trunc(params.pageNumber ?? 1))),
    records: String(Math.min(Math.max(Math.trunc(params.records ?? 30), 1), 30)),
  });
  if (params.issueType) query.set("issue_type", params.issueType);
  return upstoxIpoRequest(`/v2/ipos?${query.toString()}`);
}

export function getUpstoxIpoDetail(id: string): Promise<UpstoxResult> {
  return upstoxIpoRequest(`/v2/ipos/${encodeURIComponent(id)}`);
}

/**
 * Whether UPSTOX_ACCESS_TOKEN is still accepted, from one last-price lookup
 * for NIFTY 50. (The account profile endpoint would be cheaper, but this app's
 * token is a market-data token and Upstox refuses it there with UDAPI1221 —
 * verified 24 Oct 2026 — so it would always look expired.) Every Indian price,
 * IPO, mover and MCX contract depends on this one token, so /api/health
 * reports it.
 */
export function checkUpstoxToken(): Promise<UpstoxResult> {
  return upstoxIpoRequest("/v2/market-quote/ltp?instrument_key=" + encodeURIComponent("NSE_INDEX|Nifty 50"));
}
