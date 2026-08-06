import { getCompanyProfile } from "../apis/finnhub";
import { getCompanyOverview } from "../apis/alphavantage";
import { normalizeFinnhubCompany, normalizeAlphaCompany } from "../adapters/company";

export async function fetchCompany(
  symbol: string
) {
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