import type { YahooDividends, YahooFundamentals } from "../apis/yahooFundamentals";

/**
 * The valuation figures on a stock page, each with where it came from.
 *
 *   market cap      price × shares outstanding (Yahoo share count). Computed
 *                   here for every stock so the unit is always the stock's own
 *                   currency — Finnhub reports US market caps in millions.
 *   EPS (TTM)       the provider's figure, else Yahoo's trailing diluted EPS
 *   P/E             the provider's figure, else price ÷ EPS
 *   dividend yield  the provider's figure, else last-12-months dividends ÷ price
 *
 * A figure that can't be sourced or computed is null — never estimated.
 */

export type Sourced = { value: number; source: string } | null;

export type KeyStats = {
  marketCap: Sourced;
  eps: Sourced;
  pe: Sourced;
  dividendYield: Sourced;
};

export type ProviderFinancials = {
  pe?: number | null;
  eps?: number | null;
  dividendYield?: number | null;
} | null;

const positive = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function buildKeyStats(input: {
  price: number | null;
  provider: ProviderFinancials;
  providerName: string;
  yahoo: YahooFundamentals | null;
  dividends: YahooDividends | null;
}): KeyStats {
  const { price, provider, providerName, yahoo, dividends } = input;
  const priced = positive(price);

  const marketCap: Sourced =
    priced && yahoo?.sharesOutstanding
      ? { value: Math.round(price * yahoo.sharesOutstanding.value), source: `Price × shares outstanding (Yahoo, shares as of ${yahoo.sharesOutstanding.asOf})` }
      : null;

  const eps: Sourced = positive(provider?.eps)
    ? { value: round(provider.eps, 2), source: providerName }
    : yahoo?.epsTtm
      ? { value: round(yahoo.epsTtm.value, 2), source: `Yahoo, trailing 12 months to ${yahoo.epsTtm.asOf}` }
      : null;

  const pe: Sourced = positive(provider?.pe)
    ? { value: round(provider.pe, 2), source: providerName }
    : priced && eps && eps.value > 0
      ? { value: round(price / eps.value, 2), source: "Price ÷ EPS (TTM)" }
      : null;

  // A provider's 0 is "no dividend reported", which the 12-month history can
  // confirm or correct, so only a positive provider figure wins.
  const dividendYield: Sourced = positive(provider?.dividendYield)
    ? { value: round(provider.dividendYield, 2), source: providerName }
    : priced && dividends
      ? {
          value: round((dividends.total12m / price) * 100, 2),
          source: dividends.count > 0 ? `Dividends paid in the last 12 months ÷ price (Yahoo, last ${dividends.lastDate})` : "No dividends in the last 12 months (Yahoo)",
        }
      : null;

  return { marketCap, eps, pe, dividendYield };
}

/**
 * Market cap the way the market quotes it: ₹ lakh crore / crore for rupees,
 * T / B / M otherwise.
 */
export function formatMarketCap(value: number | null, currency: string | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "N/A";
  if (currency === "INR") {
    const crore = value / 1e7;
    if (crore >= 1e5) return `₹${(crore / 1e5).toFixed(2)} L Cr`;
    return `₹${crore.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
  }
  const symbol = currency === "USD" ? "$" : "";
  if (value >= 1e12) return `${symbol}${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `${symbol}${(value / 1e9).toFixed(2)}B`;
  return `${symbol}${(value / 1e6).toFixed(2)}M`;
}
