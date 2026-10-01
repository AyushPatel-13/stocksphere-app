import { z } from "zod";
import { stocks } from "@/lib/stocks";
import { toCanonicalIndianSymbol } from "@/lib/data/instruments/india";
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

// The words a registry decorates a company name with that say nothing about
// *which* company it is: "Reliance Industries Ltd" and "Reliance Industries" are
// the same name to someone typing it. Only these trailing forms are dropped —
// never a distinguishing word. "Industries" is what separates Reliance
// Industries from Reliance Power, so stripping it would merge two companies.
const LEGAL_FORM_TOKENS = new Set([
  "ltd",
  "limited",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
  "llp",
  "pvt",
  "private",
]);

const NAME_SEPARATORS = /[^a-z0-9]+/g;

/**
 * A company name reduced to comparable words: lower-cased, punctuation dropped,
 * trailing legal forms removed. "HDFC Bank Ltd" and "HDFC Bank" both become
 * ["hdfc", "bank"].
 *
 * Exported for direct unit testing.
 */
export function companyNameTokens(name: string): string[] {
  const tokens = name.toLowerCase().split(NAME_SEPARATORS).filter(Boolean);

  while (tokens.length > 0 && LEGAL_FORM_TOKENS.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  return tokens;
}

/** Whether `name` begins with the query as a whole run of words, not mid-word. */
function startsWithTokenRun(nameTokens: string[], queryTokens: string[]): boolean {
  return (
    queryTokens.length > 0 &&
    queryTokens.length <= nameTokens.length &&
    queryTokens.every((token, index) => nameTokens[index] === token)
  );
}

// Ordered by how much the match actually proves:
//
//   0  the query IS the ticker                    "TCS"          -> TCS
//   1  the query is the start of the ticker       "RELI"         -> RELIANCE
//   2  the query IS the company name              "Infosys"      -> Infosys Ltd
//   3  the name starts with the query as words    "HDFC Bank"    -> HDFC Bank Ltd
//   4  the name contains the query                "Infosys"      -> HCL Infosystems
//   5  anything else (e.g. symbol merely contains the query)
//
// Tiers 2 and 3 compare *words with the legal form set aside*, not raw strings.
// Comparing raw strings made both of them almost unreachable in production: the
// registry spells the name out ("Infosys Ltd", "HDFC Bank Ltd"), so a query
// that a person would call an exact company name never equalled the stored one
// and fell through to "contains". That is what put HCL-INSYS above INFY for
// "Infosys" — both merely *contain* it — and left the resolver with no tier at
// all for "Reliance" -> "Reliance Industries Ltd".
//
// Tier 2 stays separate from tier 3 for the same reason it always was: two
// candidates at one rank read to the model as equally likely, so the company
// that *is* the thing asked for must outrank the one that merely begins with it.
// Tier 3 is the honest home of real ambiguity — "Tata" leaves TATAMOTORS,
// TATASTEEL and TCS tied, and they should stay tied.
function rankTier(
  candidate: SymbolCandidate,
  lowerSearchTerm: string,
  queryTokens: string[]
): number {
  const bareSymbol = stripIndianSuffix(candidate.symbol).toLowerCase();

  if (bareSymbol === lowerSearchTerm) return 0;
  if (bareSymbol.startsWith(lowerSearchTerm)) return 1;

  const nameTokens = companyNameTokens(candidate.name);

  if (nameTokens.length > 0 && nameTokens.join(" ") === queryTokens.join(" ")) return 2;
  if (startsWithTokenRun(nameTokens, queryTokens)) return 3;

  const lowerName = candidate.name.toLowerCase();

  if (lowerName === lowerSearchTerm) return 2;
  if (lowerName.includes(lowerSearchTerm)) return 4;
  return 5;
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
      "Look up possible ticker symbols from a company name, ticker, or partial symbol. Indian (NSE) stocks are searched through Upstox's instrument search and returned with a '.NS' suffix (e.g. 'TCS.NS'); a small built-in list of well-known companies, including US/global ones, is also checked. Accepts inputs like 'TCS', 'TCS.NS', or 'Tata Consultancy'. Candidates are ordered by how much the match proves — an exact ticker, then the company name itself, then names that begin with what was typed — so several candidates sharing the top rank is a real ambiguity, not a ranking that has simply failed. This is NOT a full global market search: it may return no match, an unrelated partial match, or several candidates, and non-Indian companies outside the built-in list will not be found. Pass a symbol exactly as returned to other tools. Always tell the user when a match is uncertain, and never treat a candidate as confirmed without also fetching its price or company data.",
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
