/**
 * NSE's daily F&O ban list: the securities in the ban period for the next
 * trade date. Public file, no key needed.
 *
 *   Securities in Ban For Trade Date 26-OCT-2026:
 *   1,AMBUJACEM
 *   2,KAYNES
 *
 * An empty list (just the header) is a valid answer: no securities in ban.
 */

export const FO_BAN_URL = "https://nsearchives.nseindia.com/content/fo/fo_secban.csv";

export type FoBanList = { tradeDate: string; securities: string[]; sourceUrl: string };

const MONTHS: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** Parses the file; null when it isn't in the expected shape (never a guessed list). */
export function parseFoBanCsv(text: string): Omit<FoBanList, "sourceUrl"> | null {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const header = lines[0]?.match(/Securities in Ban For Trade Date\s+(\d{2})-([A-Z]{3})-(\d{4})/i);
  if (!header || !MONTHS[header[2].toUpperCase()]) return null;
  const securities: string[] = [];
  for (const line of lines.slice(1)) {
    const row = line.match(/^\d+\s*,\s*([A-Z0-9&.-]{1,20})\s*$/i);
    if (!row) return null;
    securities.push(row[1].toUpperCase());
  }
  return { tradeDate: `${header[3]}-${MONTHS[header[2].toUpperCase()]}-${header[1]}`, securities };
}

const CACHE_MS = 15 * 60_000;
let cache: { at: number; value: FoBanList } | null = null;

export async function getFoBanList(fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<FoBanList | null> {
  if (cache && now() - cache.at < CACHE_MS) return cache.value;
  try {
    const response = await fetchImpl(FO_BAN_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (StockSphere)", Accept: "text/csv,text/plain" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const parsed = parseFoBanCsv(await response.text());
    if (!parsed) return null;
    const value = { ...parsed, sourceUrl: FO_BAN_URL };
    cache = { at: now(), value };
    return value;
  } catch {
    return null;
  }
}

/** Test hook: forget the cached list. */
export function clearFoBanCache() {
  cache = null;
}
