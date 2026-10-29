/**
 * NSE's list of every main-board equity: symbol, full company name, series
 * and ISIN. Public file, no key needed.
 *
 *   SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE
 *   20MICRONS,20 Microns Limited,EQ,06-OCT-2008,5,1,INE144J01027,5
 *
 * It's the identity StockSphere maps NSE announcements against
 * (lib/markets/nseEvents.ts): announcements name a company in full, as this
 * file does, while Upstox abbreviates names ("RAILTEL CORP OF IND LTD").
 * SME listings (series SM/ST) aren't in it; an announcement about one stays
 * unmapped rather than being guessed.
 */

export const NSE_EQUITY_MASTER_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";

export type NseListing = {
  symbol: string;
  name: string;
  series: string;
  isin: string;
  /** ISO date (YYYY-MM-DD), or null when the file's date isn't readable. */
  listedOn: string | null;
};

const MONTHS: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

const ISIN = /^IN[A-Z0-9]{9}[0-9]$/;
const SYMBOL = /^[A-Z0-9&.-]{1,20}$/;

function isoDate(value: string): string | null {
  const match = value.trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  const month = match && MONTHS[match[2].toUpperCase()];
  return match && month ? `${match[3]}-${month}-${match[1]}` : null;
}

/** Splits one CSV line, honouring double quotes (a name may contain a comma). */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else cell += char;
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

/**
 * Parses the file; null when the header isn't the expected one (never a
 * guessed list). Rows without a valid symbol or ISIN are skipped.
 */
export function parseNseEquityMaster(text: string): NseListing[] | null {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
  const header = splitCsvLine(lines[0] ?? "").map((cell) => cell.toUpperCase());
  const at = (name: string) => header.indexOf(name);
  const columns = { symbol: at("SYMBOL"), name: at("NAME OF COMPANY"), series: at("SERIES"), listed: at("DATE OF LISTING"), isin: at("ISIN NUMBER") };
  if (Object.values(columns).some((index) => index < 0)) return null;

  const listings: NseListing[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const symbol = (cells[columns.symbol] ?? "").toUpperCase();
    const isin = (cells[columns.isin] ?? "").toUpperCase();
    const name = cells[columns.name] ?? "";
    if (!SYMBOL.test(symbol) || !ISIN.test(isin) || !name) continue;
    listings.push({ symbol, name, series: (cells[columns.series] ?? "").toUpperCase(), isin, listedOn: isoDate(cells[columns.listed] ?? "") });
  }
  return listings;
}

// The list changes when a company lists, renames or delists: once a day is plenty.
const CACHE_MS = 24 * 60 * 60_000;
let cache: { at: number; value: NseListing[] } | null = null;

export async function getNseEquityMaster(fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<NseListing[] | null> {
  if (cache && now() - cache.at < CACHE_MS) return cache.value;
  try {
    const response = await fetchImpl(NSE_EQUITY_MASTER_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (StockSphere)", Accept: "text/csv,text/plain" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const value = parseNseEquityMaster(await response.text());
    // An empty or malformed list isn't kept, so the next call retries.
    if (!value || value.length === 0) return null;
    cache = { at: now(), value };
    return value;
  } catch {
    return null;
  }
}

/** Test hook: forget the cached list. */
export function clearNseEquityMasterCache() {
  cache = null;
}
