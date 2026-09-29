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

/**
 * The only two fields normalizeUpstoxCompany reads off Upstox's
 * instrument-search row. Declared explicitly because nothing else on that row
 * is used: the row also carries instrument_key, isin, exchange_token,
 * tick_size, lot_size and other trading metadata, none of which may reach a
 * CompanyProfile.
 */
export interface UpstoxCompanyRow {
  name?: string;
  exchange?: string;
}

/**
 * Normalize a raw Upstox instrument-search row into a CompanyProfile.
 *
 * Upstox is an instrument/trading master, not a fundamentals provider: its row
 * carries the company name and exchange plus trading metadata, and nothing
 * else. There is no sector, industry, market cap, website, logo or description
 * available, so those are emitted as empty placeholders rather than invented
 * values — the same convention normalizeFinnhubCompany already uses for
 * `description`.
 *
 * `requestedSymbol` is StockSphere's canonical symbol (e.g. "TCS.NS") and is
 * echoed back unchanged. Upstox has no ".NS" concept, so the row's own trading
 * symbol is deliberately not used as the profile symbol.
 *
 * The raw row is never spread: every field is named explicitly below, so
 * instrument_key, isin, exchange_token, tick_size, lot_size, freeze_quantity,
 * qty_multiplier, security_type, cas_eligible and the remaining trading
 * metadata cannot leak into the agent's tool output.
 */
export function normalizeUpstoxCompany(
  raw: UpstoxCompanyRow,
  requestedSymbol: string
): CompanyProfile {
  return {
    symbol: requestedSymbol,

    // fetchCompany() only calls this once the row's name is known non-empty,
    // so the fallbacks are unreachable in practice; they keep the contract
    // honest if Upstox ever omits a field.
    name: raw.name ?? "",

    exchange: raw.exchange ?? "",

    country: "India",

    currency: "INR",

    sector: "",

    industry: "",

    // Upstox reports no market capitalisation. NaN is what a missing numeric
    // field already produces on the Finnhub path, and JSON.stringify turns it
    // into null, which is the "not reported by the data provider" signal the
    // agent's tool output uses.
    marketCap: NaN,

    logo: "",

    website: "",

    description: "",
  };
}