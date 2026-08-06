import { CompanyProfile } from "../types/company";

export function normalizeFinnhubCompany(
  data: any
): CompanyProfile {
  return {
    symbol: data.ticker,

    name: data.name,

    exchange: data.exchange,

    country: data.country,

    currency: data.currency,

    sector: data.finnhubIndustry,

    industry: data.finnhubIndustry,

    marketCap: Number(data.marketCapitalization),

    logo: data.logo,

    website: data.weburl,

    description: "",
  };
}

export function normalizeAlphaCompany(
  data: any
): CompanyProfile {
  return {
    symbol: data.Symbol,

    name: data.Name,

    exchange: data.Exchange,

    country: data.Country,

    currency: data.Currency,

    sector: data.Sector,

    industry: data.Industry,

    marketCap: Number(data.MarketCapitalization),

    logo: "",

    website: data.OfficialSite,

    description: data.Description,
  };
}