import { z } from "zod";
import { stocks } from "@/lib/stocks";
import {
  searchUpstoxEquityCandidates,
  type UpstoxEquityCandidate,
} from "@/lib/apis/upstox";
import { ToolDefinition, SymbolCandidate, SymbolResolution, okResult } from "../types";

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
// getMarketQuote() decides Indian-vs-global routing purely by a ".NS"/".BSE"
// suffix, so a bare Indian symbol (e.g. "TCS") would silently go down the
// US/global provider path instead of Upstox. Every Indian candidate this tool
// returns therefore carries ".NS"; US/global symbols are returned unchanged.
//
// lib/stocks.ts has no market/exchange field, so the Indian entries are listed
// explicitly here (mirroring the "India" section of lib/stocks.ts). An Indian
// symbol missing from this set fails safe: it stays bare, i.e. today's behavior.
// (Candidates that come from Upstox are always NSE equities and are suffixed
// unconditionally, so they don't depend on this set.)
const INDIAN_SYMBOLS: ReadonlySet<string> = new Set([
  "RELIANCE",
  "TCS",
  "INFY",
  "HDFCBANK",
  "ICICIBANK",
  "SBIN",
  "WIPRO",
  "LT",
  "BEL",
  "HAL",
  "TRENT",
  "ADANIPORTS",
  "TATAMOTORS",
  "BHARTIARTL",
  "KOTAKBANK",
]);

// Exported for direct unit testing.
export function toCanonicalSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (upper.endsWith(".NS") || upper.endsWith(".BSE")) return upper;
  return INDIAN_SYMBOLS.has(upper) ? `${upper}.NS` : symbol;
}

// Removes a trailing ".NS"/".BSE" (any case) so "TCS.NS" and "TCS" search the
// same thing. Upstox's search is free-text and punctuation doesn't help it.
// Exported for direct unit testing.
export function stripIndianSuffix(value: string): string {
  return value.replace(/\.(NS|BSE)$/i, "").trim();
}

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

// 0 = exact trading-symbol match, 1 = symbol prefix, 2 = name contains query,
// 3 = anything else (e.g. symbol merely contains the query).
function rankTier(candidate: SymbolCandidate, lowerSearchTerm: string): number {
  const bareSymbol = stripIndianSuffix(candidate.symbol).toLowerCase();

  if (bareSymbol === lowerSearchTerm) return 0;
  if (bareSymbol.startsWith(lowerSearchTerm)) return 1;
  if (candidate.name.toLowerCase().includes(lowerSearchTerm)) return 2;
  return 3;
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

  return [...bySymbol.values()]
    .map((candidate, index) => ({
      candidate,
      index,
      tier: rankTier(candidate, lowerSearchTerm),
    }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map(({ candidate }) => candidate)
    .slice(0, MAX_CANDIDATES);
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
      "Look up possible ticker symbols from a company name, ticker, or partial symbol. Indian (NSE) stocks are searched through Upstox's instrument search and returned with a '.NS' suffix (e.g. 'TCS.NS'); a small built-in list of well-known companies, including US/global ones, is also checked. Accepts inputs like 'TCS', 'TCS.NS', or 'Tata Consultancy'. This is NOT a full global market search: it may return no match, an unrelated partial match, or several candidates, and non-Indian companies outside the built-in list will not be found. Pass a symbol exactly as returned to other tools. Always tell the user when a match is uncertain, and never treat a candidate as confirmed without also fetching its price or company data.",
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
      const searchTerm = stripIndianSuffix(query);

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

      const result: SymbolResolution = { query, candidates, authoritative: false };
      return okResult(result, upstoxConsulted ? SOURCE_WITH_UPSTOX : SOURCE_LOCAL);
    },
  };
}

export const symbolResolverTool = createSymbolResolverTool();
