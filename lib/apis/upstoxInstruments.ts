import { upstoxFetch } from "./upstoxGate";
import type { UpstoxErrorCode } from "./upstox";

/**
 * Upstox instrument search by ISIN, for linking a listed IPO to its ticker.
 *
 *   GET /v2/instruments/search?query=<ISIN>&exchanges=NSE|BSE&segments=EQ
 *
 * Verified on 2026-10-24: query=INE467B01029 returns exactly TCS on NSE_EQ
 * (instrument_type "EQ") and on BSE_EQ (instrument_type "A"), each row
 * carrying the ISIN. Search is fuzzy in general, so callers must still keep
 * only rows whose `isin` equals the one asked for — never a name match.
 *
 * instrument_types is not filtered: BSE groups ("A", "B", "T"…) and SME
 * series all arrive under the EQ segment with different types.
 */

export type InstrumentRow = {
  tradingSymbol: string;
  segment: string;
  isin: string | null;
  instrumentKey: string;
  instrumentType: string | null;
  name: string | null;
  /** Upstox's short name; for a corporate bond often the issuer ("REC"). */
  shortName?: string | null;
};

export type InstrumentSearch = { ok: true; rows: InstrumentRow[] } | { ok: false; code: UpstoxErrorCode };

const TIMEOUT_MS = 8_000;

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** The documented response → rows; null when it isn't that shape. */
export function parseInstrumentSearch(body: unknown): InstrumentRow[] | null {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  const rows: InstrumentRow[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const tradingSymbol = text(r.trading_symbol);
    const segment = text(r.segment);
    const instrumentKey = text(r.instrument_key);
    if (!tradingSymbol || !segment || !instrumentKey) continue;
    rows.push({
      tradingSymbol: tradingSymbol.toUpperCase(),
      segment,
      isin: text(r.isin)?.toUpperCase() ?? null,
      instrumentKey,
      instrumentType: text(r.instrument_type),
      name: text(r.name),
      shortName: text(r.short_name),
    });
  }
  return rows;
}

export function searchInstrumentsByIsin(isin: string, exchange: "NSE" | "BSE"): Promise<InstrumentSearch> {
  return searchCashSegment(isin, exchange);
}

/**
 * Free-text search of the NSE/BSE cash segment (EQ), where Upstox also lists
 * government securities, T-bills, gold bonds and corporate bonds — each row
 * with its ISIN. Verified on 2026-10-26: "GOI 2034" → GOI LOAN … 2034 rows
 * (instrument_type GS on NSE, G on BSE); "INE062A08" (an issuer's ISIN
 * prefix) → that issuer's bonds. Fuzzy: callers filter the rows themselves.
 */
export async function searchCashSegment(query: string, exchanges: "NSE" | "BSE" | "NSE,BSE" = "NSE,BSE"): Promise<InstrumentSearch> {
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) return { ok: false, code: "not_configured" };

  const params = new URLSearchParams({ query, exchanges, segments: "EQ", page_number: "1", records: "30" });

  try {
    const response = await upstoxFetch(`https://api.upstox.com/v2/instruments/search?${params.toString()}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) return { ok: false, code: "auth" };
    if (response.status === 429) return { ok: false, code: "rate_limited" };
    if (!response.ok) return { ok: false, code: "provider" };
    const rows = parseInstrumentSearch(await response.json().catch(() => null));
    return rows ? { ok: true, rows } : { ok: false, code: "provider" };
  } catch (error) {
    return { ok: false, code: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "provider" };
  }
}
