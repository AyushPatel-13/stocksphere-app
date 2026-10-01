import { getCompanyProfile } from "../apis/finnhub";
import { getCompanyOverview } from "../apis/alphavantage";
import { searchUpstoxEquity } from "../apis/upstox";
import {
  bareIndianSymbol,
  isIndianEquitySymbol,
} from "../data/instruments/india";
import {
  normalizeFinnhubCompany,
  normalizeAlphaCompany,
  normalizeUpstoxCompany,
  type UpstoxCompanyRow,
} from "../adapters/company";

/**
 * The Indian equity lookup this path needs: given a bare NSE trading symbol,
 * return the matching Upstox instrument row (or null).
 *
 * Injected into fetchCompany() so tests can supply a fake, following the same
 * convention as createSymbolResolverTool()'s searchIndianCandidates parameter
 * — no test needs UPSTOX_ACCESS_TOKEN or a network call.
 */
export type IndianEquitySearch = (
  symbol: string
) => Promise<UpstoxCompanyRow | null>;

// A symbol is Indian if it carries the ".NS"/".BSE" convention OR if it is a
// bare symbol in the app's Indian instrument universe
// (lib/data/instruments/india.ts). The suffix test alone let a bare "INFY"
// leave this path and be answered by a global provider instead.
function isIndianSymbol(symbol: string): boolean {
  return (
    symbol.endsWith(".NS") ||
    symbol.endsWith(".BSE") ||
    isIndianEquitySymbol(symbol)
  );
}

function normalizeIndianSymbol(symbol: string): string {
  return bareIndianSymbol(symbol);
}

export async function fetchCompany(
  symbol: string,
  searchIndianEquity: IndianEquitySearch = searchUpstoxEquity
) {
  // Upstox (Primary for Indian equities)
  //
  // The ".NS"/".BSE" suffix is stripped for this Upstox lookup and nothing
  // else: Upstox has no suffix concept and its search is an exact match on the
  // NSE trading symbol, so "TCS.NS" would never match. The bare symbol is
  // never handed to Finnhub, Alpha Vantage, or any other provider — in those
  // namespaces a bare "TCS" resolves to an unrelated company.
  //
  // Upstox is tried before the global providers for Indian symbols because
  // both of them have been verified to reject Indian symbols outright.
  if (isIndianSymbol(symbol)) {
    try {
      const instrument =
        await searchIndianEquity(
          normalizeIndianSymbol(symbol)
        );

      if (instrument?.name) {
        console.log("✅ Upstox Company");

        return {
          provider: "Upstox",
          data: normalizeUpstoxCompany(
            instrument,
            symbol
          ),
        };
      }
    } catch {}

    // A recognised Indian equity answers through Upstox or not at all.
    //
    // This is the one provider where the two chains used to be reachable in
    // sequence rather than instead of each other: a ".NS" symbol was rejected
    // by both global providers, so falling through was harmless and went
    // unnoticed — but a bare "TCS" is a different company in Finnhub's and
    // Alpha Vantage's namespaces, and answering with it would be exactly the
    // silent substitution this rule exists to prevent.
    return null;
  }

  // Finnhub (Primary)
  try {
    const company =
      await getCompanyProfile(symbol);

    if (company?.name) {
      console.log("✅ Finnhub Company");

      return {
        provider: "Finnhub",
        data: normalizeFinnhubCompany(company),
      };
    }
  } catch {}

  // Alpha Vantage (Fallback)
  try {
    const company =
      await getCompanyOverview(symbol);

    if (company?.Name) {
      console.log("✅ Alpha Company");

      return {
        provider: "AlphaVantage",
        data: normalizeAlphaCompany(company),
      };
    }
  } catch {}

  return null;
}
