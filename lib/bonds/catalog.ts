import { searchCashSegment, type InstrumentRow, type InstrumentSearch } from "../apis/upstoxInstruments";
import type { UpstoxErrorCode } from "../apis/upstox";
import { bondMatches, isEquityIsin, issuerCode, parseBondQuery, toBonds, type Bond } from "./bonds";

/**
 * Bond lookups against the exchanges' listings (Upstox cash-segment search).
 * Server only. Every bond returned is a real NSE/BSE record with its ISIN;
 * see lib/bonds/bonds.ts for which fields are kept and why.
 *
 *   searchBonds("Government of India 2034")  → GOI LOAN … 2034 bonds
 *   searchBonds("REC bond")                  → REC Limited's listed bonds,
 *                                              found through REC's ISIN issuer code
 *   searchBonds("IN0020230085") / getBond()  → that bond
 *
 * Answers are cached for 10 minutes (bond listings change rarely), so typing
 * in the @ box doesn't turn every keystroke into Upstox calls.
 */

export type BondDeps = { search: (query: string) => Promise<InstrumentSearch> };

const TTL_MS = 10 * 60_000;
const MAX_CACHED = 500;
const cache = new Map<string, { at: number; value: InstrumentSearch }>();

async function cachedSearch(query: string): Promise<InstrumentSearch> {
  const key = query.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await searchCashSegment(query);
  if (value.ok) {
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), value });
  }
  return value;
}

export const defaultBondDeps: BondDeps = { search: cachedSearch };

export const MAX_BOND_SUGGESTIONS = 5;

/** Issuer code → listed equity name, from rows that are that issuer's equity. */
function issuersIn(rows: InstrumentRow[]): Map<string, string> {
  const issuers = new Map<string, string>();
  for (const row of rows) {
    if (!isEquityIsin(row.isin) || !row.name) continue;
    const code = issuerCode(row.isin!);
    if (code && !issuers.has(code)) issuers.set(code, row.name.replace(/\s+/g, " ").trim());
  }
  return issuers;
}

/** The listed equity carrying this issuer code, if there is one. */
async function issuerName(code: string, deps: BondDeps): Promise<string | null> {
  const found = await deps.search(`${code}01`).catch(() => null);
  if (!found?.ok) return null;
  return issuersIn(found.rows.filter((row) => row.isin?.startsWith(code))).get(code) ?? null;
}

/** Fills in corporate issuers (at most `limit` distinct ones, to bound calls). */
async function withIssuers(bonds: Bond[], known: Map<string, string>, deps: BondDeps, limit = 2): Promise<Bond[]> {
  const missing = [...new Set(bonds.filter((b) => b.category === "corporate" && !b.issuer).map((b) => issuerCode(b.isin)).filter((c): c is string => Boolean(c) && !known.has(c!)))].slice(0, limit);
  const names = await Promise.all(missing.map((code) => issuerName(code, deps)));
  missing.forEach((code, i) => {
    if (names[i]) known.set(code, names[i]!);
  });
  return bonds.map((b) => {
    const code = b.category === "corporate" && !b.issuer ? issuerCode(b.isin) : null;
    return code && known.has(code) ? { ...b, issuer: known.get(code)! } : b;
  });
}

export type BondSearch = { bonds: Bond[]; partial: boolean };

export async function searchBonds(raw: string, deps: BondDeps = defaultBondDeps, limit = MAX_BOND_SUGGESTIONS): Promise<BondSearch> {
  const query = parseBondQuery(raw);
  if (!query) return { bonds: [], partial: false };

  const first = await deps.search(query.upstream).catch(() => null);
  if (!first?.ok) return { bonds: [], partial: true };

  let rows = first.rows;
  const issuers = issuersIn(rows);
  let partial = false;

  // "<company> bond": the name finds its equity; its bonds share the
  // equity's ISIN issuer code (characters 1–7) with security code 07 or 08.
  // Only when the query asks for bonds, so "@sbi" stays about the stock.
  if (query.explicit && !query.isin && !query.categories && query.words.length > 0) {
    const equity = rows.find((row) => {
      if (!isEquityIsin(row.isin) || !row.name) return false;
      const words = [...row.name.toLowerCase().split(/[^a-z0-9&]+/), row.tradingSymbol.toLowerCase(), (row.shortName ?? "").toLowerCase()];
      return query.words.every((word) => words.some((w) => w.startsWith(word)));
    });
    const code = equity?.isin ? issuerCode(equity.isin) : null;
    if (code) {
      const more = await Promise.all([deps.search(`${code}07`), deps.search(`${code}08`)].map((p) => p.catch(() => null)));
      for (const result of more) {
        if (result?.ok) rows = [...rows, ...result.rows.filter((row) => row.isin?.startsWith(code))];
        else partial = true;
      }
    }
  }

  const matched = toBonds(rows, issuers).filter((bond) => bondMatches(bond, query)).slice(0, limit);
  return { bonds: await withIssuers(matched, issuers, deps), partial };
}

export type BondLookup = { ok: true; bond: Bond } | { ok: false; code: "not_found" | UpstoxErrorCode };

/** One bond by ISIN, straight from the exchange listing. */
export async function getBond(isin: string, deps: BondDeps = defaultBondDeps): Promise<BondLookup> {
  const found = await deps.search(isin).catch(() => ({ ok: false as const, code: "provider" as const }));
  if (!found.ok) return { ok: false, code: found.code };
  const [bond] = toBonds(found.rows.filter((row) => row.isin === isin), issuersIn(found.rows));
  if (!bond) return { ok: false, code: "not_found" };
  const [full] = await withIssuers([bond], new Map(), deps, 1);
  return { ok: true, bond: full };
}
