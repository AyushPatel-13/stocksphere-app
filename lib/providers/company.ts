import { getCompanyProfile } from "../apis/finnhub";
import { getCompanyOverview } from "../apis/alphavantage";
import { searchUpstoxEquity } from "../apis/upstox";
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

// Mirrors the routing rule in lib/providers/market.provider.ts, where
// isIndianSymbol/normalizeIndianSymbol are module-private and therefore not
// importable. Kept identical so the company path and the quote path agree on
// what counts as an Indian symbol.
function isIndianSymbol(symbol: string): boolean {
  return (
    symbol.endsWith(".NS") ||
    symbol.endsWith(".BSE")
  );
}

function normalizeIndianSymbol(symbol: string): string {
  return symbol
    .replace(".NS", "")
    .replace(".BSE", "")
    .toUpperCase();
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
