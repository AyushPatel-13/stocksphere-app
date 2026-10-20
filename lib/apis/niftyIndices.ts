/**
 * NSE index constituents, from the official lists NSE Indices publishes:
 *
 *   https://www.niftyindices.com/IndexConstituent/<file>.csv
 *   "Company Name,Industry,Symbol,Series,ISIN Code"
 *
 * The "Industry" column carries NSE's sector-level classification (e.g.
 * "Financial Services", "Capital Goods"), so it is surfaced as the sector.
 * NSE's finer industry levels are not in these files.
 *
 * Lists change at semi-annual rebalances, so a fetched list is reused for a
 * day; on a failed refresh the last good list is kept. A list that has never
 * loaded is null — never a hand-written fallback.
 */

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TIMEOUT_MS = 10_000;
const CACHE_MS = 24 * 60 * 60_000;

export const NSE_INDEX_UNIVERSES = {
  nifty50: { label: "NIFTY 50", file: "ind_nifty50list" },
  niftynext50: { label: "NIFTY Next 50", file: "ind_niftynext50list" },
  nifty100: { label: "NIFTY 100", file: "ind_nifty100list" },
  nifty200: { label: "NIFTY 200", file: "ind_nifty200list" },
  nifty500: { label: "NIFTY 500", file: "ind_nifty500list" },
  niftymidcap100: { label: "NIFTY Midcap 100", file: "ind_niftymidcap100list" },
  niftysmallcap100: { label: "NIFTY Smallcap 100", file: "ind_niftysmallcap100list" },
  niftybank: { label: "NIFTY Bank", file: "ind_niftybanklist" },
  niftyit: { label: "NIFTY IT", file: "ind_niftyitlist" },
} as const;

export type NseIndexId = keyof typeof NSE_INDEX_UNIVERSES;

export type Constituent = { symbol: string; name: string; sector: string | null; isin: string };

export type ConstituentList = { constituents: Constituent[]; fetchedAt: string; source: string };

/** Split one CSV line, honouring double-quoted fields ("Foo, Ltd."). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/** Parse an NSE constituent CSV; null if the header isn't the expected one. */
export function parseConstituentCsv(text: string): Constituent[] | null {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return null;
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const [iName, iIndustry, iSymbol, iIsin] = [col("company name"), col("industry"), col("symbol"), col("isin code")];
  if (iName < 0 || iSymbol < 0 || iIsin < 0) return null;

  const seen = new Set<string>();
  const out: Constituent[] = [];
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line);
    const symbol = (f[iSymbol] ?? "").toUpperCase();
    const isin = (f[iIsin] ?? "").toUpperCase();
    // Every series is a real constituent (EQ, BE trade-to-trade, RR REITs);
    // NSE's "Dummy …" placeholder rows during corporate actions carry a
    // non-ISIN code and are dropped by the ISIN check.
    if (!/^[A-Z0-9&-]{1,20}$/.test(symbol) || !/^IN[A-Z0-9]{10}$/.test(isin) || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({ symbol, name: f[iName] || symbol, sector: iIndustry >= 0 && f[iIndustry] ? f[iIndustry] : null, isin });
  }
  return out.length > 0 ? out : null;
}

const cache = new Map<NseIndexId, { at: number; value: ConstituentList }>();
const inFlight = new Map<NseIndexId, Promise<ConstituentList | null>>();

export async function getNseConstituents(
  id: NseIndexId,
  fetcher: typeof fetch = fetch,
  now: number = Date.now()
): Promise<ConstituentList | null> {
  const hit = cache.get(id);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  let pending = inFlight.get(id);
  if (!pending) {
    const url = `https://www.niftyindices.com/IndexConstituent/${NSE_INDEX_UNIVERSES[id].file}.csv`;
    pending = (async () => {
      try {
        const response = await fetcher(url, {
          headers: { "User-Agent": USER_AGENT, Accept: "text/csv,*/*" },
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) {
          console.error(`NSE constituents ${id}: HTTP ${response.status}`);
          return hit?.value ?? null;
        }
        const constituents = parseConstituentCsv(await response.text());
        if (!constituents) return hit?.value ?? null;
        const value = { constituents, fetchedAt: new Date(now).toISOString(), source: "NSE Indices constituent list" };
        cache.set(id, { at: now, value });
        return value;
      } catch (error) {
        console.error(`NSE constituents ${id}:`, error instanceof Error ? error.message : "unknown");
        return hit?.value ?? null;
      } finally {
        inFlight.delete(id);
      }
    })();
    inFlight.set(id, pending);
  }
  return pending;
}

/** Test hook. */
export function clearConstituentCache() {
  cache.clear();
}
