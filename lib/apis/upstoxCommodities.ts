import type { UpstoxErrorCode, UpstoxResult } from "./upstox";
import { upstoxFetch } from "./upstoxGate";

const ACCESS_TOKEN = process.env.UPSTOX_ACCESS_TOKEN;

/**
 * Upstox endpoints for MCX commodity futures, all verified live (2026-10-24)
 * with the same Bearer token as the equity calls:
 *
 *   GET /v2/instruments/search?query=&exchanges=MCX&instrument_types=FUT
 *       contracts: segment MCX_FO, keys like "MCX_FO|573422", expiry, lot_size,
 *       qty_multiplier, tick_size (in paise), price_quote_unit
 *   GET /v2/market-quote/quotes?instrument_key=k1,k2
 *       last_price, net_change (vs the previous session's close), ohlc,
 *       volume and oi (in lots), last_trade_time (epoch ms)
 *   GET /v3/historical-candle/{key}/{unit}/{interval}/{to}/{from}
 *       finished sessions; the current session comes from
 *   GET /v3/historical-candle/intraday/{key}/{unit}/{interval}
 *
 * The underlying MCX_COM keys can't be quoted (HTTP 400), so there is no spot
 * price — only futures. Every failure is classified, as for IPOs, so the page
 * can say what went wrong. The token never leaves the server.
 */

const TIMEOUT_MS = 8_000;

async function request(path: string): Promise<UpstoxResult> {
  if (!ACCESS_TOKEN) return { ok: false, code: "not_configured", status: null };

  try {
    const response = await upstoxFetch(`https://api.upstox.com${path}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${ACCESS_TOKEN}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body: unknown = await response.json().catch(() => null);

    if (response.ok) return { ok: true, body };
    if (response.status === 401 || response.status === 403) return { ok: false, code: "auth", status: response.status };
    if (response.status === 429) return { ok: false, code: "rate_limited", status: 429 };
    console.error(`Upstox commodities ${response.status}: ${path.split("?")[0]}`);
    return { ok: false, code: "provider", status: response.status };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    if (!timedOut) console.error("Upstox commodities error:", error instanceof Error ? error.message : error);
    return { ok: false, code: timedOut ? "timeout" : "provider", status: null };
  }
}

export type McxResult<T> = { ok: true; value: T } | { ok: false; code: UpstoxErrorCode };

/** Raw search rows for one underlying symbol (all pages, at most 3). */
export async function searchMcxFutures(symbol: string): Promise<McxResult<unknown[]>> {
  const rows: unknown[] = [];

  for (let page = 1; page <= 3; page++) {
    const params = new URLSearchParams({
      query: symbol,
      exchanges: "MCX",
      instrument_types: "FUT",
      page_number: String(page),
      records: "30",
    });
    const result = await request(`/v2/instruments/search?${params.toString()}`);
    if (!result.ok) return page === 1 ? result : { ok: true, value: rows };

    const body = result.body as { data?: unknown; meta_data?: { page?: { total_pages?: number } } } | null;
    if (!Array.isArray(body?.data)) return page === 1 ? { ok: false, code: "provider" } : { ok: true, value: rows };
    rows.push(...body.data);

    const totalPages = body.meta_data?.page?.total_pages ?? 1;
    if (page >= totalPages) break;
  }

  return { ok: true, value: rows };
}

/** Full quotes, keyed by Upstox's response key ("MCX_FO:CRUDEOIL26NOVFUT"). */
export async function getMcxQuotes(instrumentKeys: string[]): Promise<McxResult<Record<string, unknown>>> {
  if (instrumentKeys.length === 0) return { ok: true, value: {} };

  const result = await request(
    `/v2/market-quote/quotes?instrument_key=${encodeURIComponent(instrumentKeys.join(","))}`
  );
  if (!result.ok) return result;

  const data = (result.body as { data?: unknown } | null)?.data;
  return data && typeof data === "object" ? { ok: true, value: data as Record<string, unknown> } : { ok: false, code: "provider" };
}

export type CandleUnit = "minutes" | "hours" | "days";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function candlesOf(result: UpstoxResult): McxResult<unknown[]> {
  if (!result.ok) return result;
  const candles = (result.body as { data?: { candles?: unknown } } | null)?.data?.candles;
  return Array.isArray(candles) ? { ok: true, value: candles } : { ok: false, code: "provider" };
}

/** Candles for finished sessions between two dates (inclusive). */
export async function getMcxCandles(
  instrumentKey: string,
  unit: CandleUnit,
  interval: number,
  fromDate: string,
  toDate: string
): Promise<McxResult<unknown[]>> {
  if (!ISO_DATE.test(fromDate) || !ISO_DATE.test(toDate) || fromDate > toDate) return { ok: false, code: "provider" };
  return candlesOf(
    await request(`/v3/historical-candle/${encodeURIComponent(instrumentKey)}/${unit}/${interval}/${toDate}/${fromDate}`)
  );
}

/** Candles for the session in progress (empty when the market is closed). */
export async function getMcxIntradayCandles(
  instrumentKey: string,
  unit: "minutes" | "hours",
  interval: number
): Promise<McxResult<unknown[]>> {
  return candlesOf(await request(`/v3/historical-candle/intraday/${encodeURIComponent(instrumentKey)}/${unit}/${interval}`));
}
