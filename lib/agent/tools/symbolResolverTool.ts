import { z } from "zod";
import { stocks } from "@/lib/stocks";
import { toCanonicalIndianSymbol } from "@/lib/data/instruments/india";
import {
  searchUpstoxEquityCandidates,
  type UpstoxEquityCandidate,
} from "@/lib/apis/upstox";
import { ToolDefinition, SymbolCandidate, SymbolResolution, okResult } from "../types";
import { companyNameTokens, matchTier } from "@/lib/search/rank";

// IMPORTANT: results are best-effort candidates, never confirmed matches.
// Indian equities come from Upstox's NSE instrument search; everything else
// (US/global, and the fallback when Upstox is unavailable) comes from the small
// hardcoded list in lib/stocks.ts. This tool must never be presented as an
// authoritative market search, and it deliberately always succeeds (ok: true)
// even with zero candidates — "no match" is a legitimate, informative result
// here, not a tool failure.
const SOURCE_LOCAL = "StockSphere Known Symbols List (limited, non-authoritative)";
const SOURCE_WITH_UPSTOX =
  "StockSphere Known Symbols List + Upstox Instrument Search (NSE equities, non-authoritative)";

const MAX_CANDIDATES = 5;
const UPSTOX_SEARCH_LIMIT = 30;
// Upstox rejects search queries longer than 50 characters.
const UPSTOX_MAX_QUERY_LENGTH = 50;

// Canonical Agent V1 symbol format for Indian equities: "<TRADING_SYMBOL>.NS".
// Market-data routing keys off the ".NS"/".BSE" suffix, so every Indian
// candidate this tool returns must carry ".NS"; US/global symbols are returned
// unchanged.
//
// The Indian-vs-global decision now lives in lib/data/instruments/india.ts,
// alongside the instrument universe it is derived from. It used to be a private
// list here, which meant the Agent and the price path could disagree about what
// an Indian symbol is.
//
// (Candidates that come from Upstox are always NSE equities and are suffixed
// unconditionally above, so they don't depend on this at all.)
export function toCanonicalSymbol(symbol: string): string {
  return toCanonicalIndianSymbol(symbol);
}

// Removes a trailing ".NS"/".BSE" (any case) so "TCS.NS" and "TCS" search the
// same thing. Upstox's search is free-text and punctuation doesn't help it.
// Exported for direct unit testing.
export function stripIndianSuffix(value: string): string {
  return value.replace(/\.(NS|BSE)$/i, "").trim();
}

/**
 * Former names people still use, mapped to the name the listing has now
 * (Upstox searches current names only). Lower-case keys.
 */
export const RENAMED_COMPANIES: Record<string, string> = {
  zomato: "Eternal",
};

const argsSchema = z.object({
  query: z.string().trim().min(1).max(80),
});

export type SymbolResolverToolArgs = z.infer<typeof argsSchema>;

/** Signature of the Indian candidate search this tool depends on (injectable for tests). */
export type IndianCandidateSearch = (
  query: string,
  limit?: number
) => Promise<UpstoxEquityCandidate[] | null>;

function searchLocalList(searchTerm: string): SymbolCandidate[] {
  const q = searchTerm.toLowerCase();

  return stocks
    .filter(
      (stock) =>
        stock.symbol.toLowerCase().includes(q) || stock.name.toLowerCase().includes(q)
    )
    .map((stock) => ({ symbol: toCanonicalSymbol(stock.symbol), name: stock.name }));
}

// Builds candidates explicitly from symbol + name only, so nothing else on the
// Upstox row (notably instrument_key) can ever reach the LLM.
function candidatesFromUpstox(rows: UpstoxEquityCandidate[]): SymbolCandidate[] {
  const candidates: SymbolCandidate[] = [];

  for (const row of rows) {
    const tradingSymbol =
      typeof row?.trading_symbol === "string" ? row.trading_symbol.trim().toUpperCase() : "";
    if (!tradingSymbol) continue;

    candidates.push({
      symbol: `${tradingSymbol}.NS`,
      name: row.name?.trim() || row.short_name?.trim() || tradingSymbol,
    });
  }

  return candidates;
}

// Ranking lives in lib/search/rank.ts, shared with the search box so the
// assistant and /api/search order matches identically. companyNameTokens is
// re-exported here because this tool's tests import it from this module.
export { companyNameTokens };

function rankTier(
  candidate: SymbolCandidate,
  lowerSearchTerm: string,
  queryTokens: string[]
): number {
  return matchTier(stripIndianSuffix(candidate.symbol), candidate.name, lowerSearchTerm, queryTokens);
}

// Upstox candidates are listed first, so when the same symbol comes from both
// sources the Upstox record (the live listing) is the one kept. Ties within a
// rank tier keep their original order.
function mergeAndRank(
  upstoxCandidates: SymbolCandidate[],
  localCandidates: SymbolCandidate[],
  lowerSearchTerm: string
): SymbolCandidate[] {
  const bySymbol = new Map<string, SymbolCandidate>();

  for (const candidate of [...upstoxCandidates, ...localCandidates]) {
    const key = candidate.symbol.toUpperCase();
    if (!bySymbol.has(key)) bySymbol.set(key, candidate);
  }

  const queryTokens = companyNameTokens(lowerSearchTerm);

  return [...bySymbol.values()]
    .map((candidate, index) => ({
      candidate,
      index,
      tier: rankTier(candidate, lowerSearchTerm, queryTokens),
    }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map(({ candidate }) => candidate)
    .slice(0, MAX_CANDIDATES);
}

/** The one candidate a query clearly names, or the tied candidates. */
export function pickCandidate(query: string, candidates: SymbolCandidate[]): { match: SymbolCandidate } | { tied: SymbolCandidate[] } | null {
  if (candidates.length === 0) return null;
  const lower = stripIndianSuffix(query).toLowerCase();
  const tokens = companyNameTokens(lower);
  const tiered = candidates.map((c) => ({ c, tier: matchTier(stripIndianSuffix(c.symbol), c.name, lower, tokens) }));
  const best = Math.min(...tiered.map((t) => t.tier));
  const top = tiered.filter((t) => t.tier === best).map((t) => t.c);

  // An exact ticker or exact company name is a match; so is a single
  // name-prefix match ("HDFC Bank"). Anything looser, or a tie, is ambiguous.
  if (best === 0 || best === 2 || (best === 3 && top.length === 1)) return { match: top[0] };
  if (candidates.length === 1 && best <= 3) return { match: candidates[0] };
  return { tied: (top.length > 1 ? top : candidates).slice(0, 4) };
}

/**
 * Factory so tests can inject a fake Indian candidate search instead of
 * calling Upstox. Production code uses the default export below.
 */
export function createSymbolResolverTool(
  searchIndianCandidates: IndianCandidateSearch = searchUpstoxEquityCandidates
): ToolDefinition<SymbolResolverToolArgs, SymbolResolution> {
  return {
    name: "resolve_symbol",
    description:
      "Find ticker candidates for a company name or ticker (e.g. 'Tata Consultancy', 'tcs'). Indian stocks via Upstox NSE search (.NS); a small built-in list covers well-known US names — not a full global search. Ranked exact ticker, exact name, then name prefix; bestMatch is set when one clearly fits. Use symbols exactly as returned.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Company name, ticker, or partial ticker as typed by the user, e.g. 'Tata Consultancy', 'tcs', or 'TCS.NS'",
        },
      },
      required: ["query"],
    },
    argsSchema,
    async execute({ query }) {
      const asked = stripIndianSuffix(query);
      const renamedTo = RENAMED_COMPANIES[asked.toLowerCase()];
      const searchTerm = renamedTo ?? asked;

      if (!searchTerm) {
        const empty: SymbolResolution = { query, candidates: [], authoritative: false };
        return okResult(empty, SOURCE_LOCAL);
      }

      // Fail soft: any Upstox problem (missing token, HTTP error, unexpected
      // response, thrown error) leaves us with the local list only.
      let upstoxCandidates: SymbolCandidate[] = [];
      let upstoxConsulted = false;

      if (searchTerm.length <= UPSTOX_MAX_QUERY_LENGTH) {
        try {
          const rows = await searchIndianCandidates(searchTerm, UPSTOX_SEARCH_LIMIT);
          if (Array.isArray(rows)) {
            upstoxCandidates = candidatesFromUpstox(rows);
            upstoxConsulted = true;
          }
        } catch {
          upstoxCandidates = [];
          upstoxConsulted = false;
        }
      }

      const candidates = mergeAndRank(
        upstoxCandidates,
        searchLocalList(searchTerm),
        searchTerm.toLowerCase()
      );

      const picked = pickCandidate(renamedTo ?? query, candidates);
      const result: SymbolResolution = {
        query,
        candidates,
        authoritative: false,
        bestMatch: picked && "match" in picked ? picked.match : null,
        ...(renamedTo ? { note: `"${asked}" is now listed as ${renamedTo}; searched for ${renamedTo}.` } : {}),
      };
      return okResult(result, upstoxConsulted ? SOURCE_WITH_UPSTOX : SOURCE_LOCAL);
    },
  };
}

export const symbolResolverTool = createSymbolResolverTool();
