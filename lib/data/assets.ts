/**
 * Non-equity asset universes: ETFs, crypto and bonds.
 *
 * Every entry was checked against Yahoo Finance's chart endpoint (2026-10-19),
 * which is where their prices and history come from. `yahoo` is the provider
 * symbol; `symbol` is StockSphere's own, used in URLs.
 */

export type AssetType = "stock" | "index" | "etf" | "crypto" | "bond";

/** How a value is written: money in a currency, index points, or a yield. */
export type ValueUnit = "currency" | "points" | "percent";

export type CatalogAsset = {
  symbol: string;
  name: string;
  yahoo: string;
  region: "india" | "us" | "global";
  currency: "INR" | "USD";
  unit: ValueUnit;
  /** A short grouping label shown on hub pages. */
  group: string;
};

export const ETFS: CatalogAsset[] = [
  { symbol: "NIFTYBEES", name: "Nippon India Nifty 50 BeES", yahoo: "NIFTYBEES.NS", region: "india", currency: "INR", unit: "currency", group: "Index" },
  { symbol: "BANKBEES", name: "Nippon India Bank BeES", yahoo: "BANKBEES.NS", region: "india", currency: "INR", unit: "currency", group: "Index" },
  { symbol: "JUNIORBEES", name: "Nippon India Nifty Next 50 BeES", yahoo: "JUNIORBEES.NS", region: "india", currency: "INR", unit: "currency", group: "Index" },
  { symbol: "ITBEES", name: "Nippon India Nifty IT ETF", yahoo: "ITBEES.NS", region: "india", currency: "INR", unit: "currency", group: "Sector" },
  { symbol: "CPSEETF", name: "CPSE ETF", yahoo: "CPSEETF.NS", region: "india", currency: "INR", unit: "currency", group: "Sector" },
  { symbol: "MON100", name: "Motilal Oswal Nasdaq 100 ETF", yahoo: "MON100.NS", region: "india", currency: "INR", unit: "currency", group: "International" },
  { symbol: "GOLDBEES", name: "Nippon India Gold BeES", yahoo: "GOLDBEES.NS", region: "india", currency: "INR", unit: "currency", group: "Commodity" },
  { symbol: "SILVERBEES", name: "Nippon India Silver ETF", yahoo: "SILVERBEES.NS", region: "india", currency: "INR", unit: "currency", group: "Commodity" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF", yahoo: "SPY", region: "us", currency: "USD", unit: "currency", group: "Index" },
  { symbol: "VOO", name: "Vanguard S&P 500 ETF", yahoo: "VOO", region: "us", currency: "USD", unit: "currency", group: "Index" },
  { symbol: "QQQ", name: "Invesco QQQ (Nasdaq 100)", yahoo: "QQQ", region: "us", currency: "USD", unit: "currency", group: "Index" },
  { symbol: "VTI", name: "Vanguard Total Stock Market ETF", yahoo: "VTI", region: "us", currency: "USD", unit: "currency", group: "Index" },
  { symbol: "IWM", name: "iShares Russell 2000 ETF", yahoo: "IWM", region: "us", currency: "USD", unit: "currency", group: "Index" },
  { symbol: "ARKK", name: "ARK Innovation ETF", yahoo: "ARKK", region: "us", currency: "USD", unit: "currency", group: "Thematic" },
  { symbol: "GLD", name: "SPDR Gold Shares", yahoo: "GLD", region: "us", currency: "USD", unit: "currency", group: "Commodity" },
  { symbol: "TLT", name: "iShares 20+ Year Treasury Bond ETF", yahoo: "TLT", region: "us", currency: "USD", unit: "currency", group: "Bonds" },
];

/** Crypto, priced in INR or USD: the Yahoo pair is `${symbol}-${currency}`. */
export const CRYPTO: { symbol: string; name: string }[] = [
  { symbol: "BTC", name: "Bitcoin" },
  { symbol: "ETH", name: "Ethereum" },
  { symbol: "BNB", name: "BNB" },
  { symbol: "SOL", name: "Solana" },
  { symbol: "XRP", name: "XRP" },
  { symbol: "DOGE", name: "Dogecoin" },
  { symbol: "ADA", name: "Cardano" },
  { symbol: "TRX", name: "TRON" },
  { symbol: "AVAX", name: "Avalanche" },
  { symbol: "LINK", name: "Chainlink" },
  { symbol: "DOT", name: "Polkadot" },
  { symbol: "LTC", name: "Litecoin" },
  { symbol: "SHIB", name: "Shiba Inu" },
];

export function cryptoAsset(symbol: string, currency: "INR" | "USD"): CatalogAsset | null {
  const coin = CRYPTO.find((entry) => entry.symbol === symbol.toUpperCase());
  if (!coin) return null;
  return {
    symbol: coin.symbol,
    name: coin.name,
    yahoo: `${coin.symbol}-${currency}`,
    region: "global",
    currency,
    unit: "currency",
    group: "Crypto",
  };
}

/**
 * Bonds. US Treasury yields are quoted as a percentage. For India, free
 * government-bond yield data isn't available from these sources, so the
 * listed instruments are exchange-traded gilt, liquid and Bharat Bond ETFs —
 * real bond exposure that trades on NSE, priced in rupees.
 */
export const BONDS: CatalogAsset[] = [
  { symbol: "US3M", name: "US 13-week Treasury bill yield", yahoo: "^IRX", region: "us", currency: "USD", unit: "percent", group: "US Treasury yields" },
  { symbol: "US5Y", name: "US 5-year Treasury yield", yahoo: "^FVX", region: "us", currency: "USD", unit: "percent", group: "US Treasury yields" },
  { symbol: "US10Y", name: "US 10-year Treasury yield", yahoo: "^TNX", region: "us", currency: "USD", unit: "percent", group: "US Treasury yields" },
  { symbol: "US30Y", name: "US 30-year Treasury yield", yahoo: "^TYX", region: "us", currency: "USD", unit: "percent", group: "US Treasury yields" },
  { symbol: "GILT5YBEES", name: "Nippon India 5-yr Gilt ETF", yahoo: "GILT5YBEES.NS", region: "india", currency: "INR", unit: "currency", group: "Indian bond ETFs" },
  { symbol: "LTGILTBEES", name: "Nippon India Long-term Gilt ETF", yahoo: "LTGILTBEES.NS", region: "india", currency: "INR", unit: "currency", group: "Indian bond ETFs" },
  { symbol: "LIQUIDBEES", name: "Nippon India Liquid BeES", yahoo: "LIQUIDBEES.NS", region: "india", currency: "INR", unit: "currency", group: "Indian bond ETFs" },
  { symbol: "EBBETF0430", name: "Bharat Bond ETF April 2030", yahoo: "EBBETF0430.NS", region: "india", currency: "INR", unit: "currency", group: "Indian bond ETFs" },
  { symbol: "EBBETF0431", name: "Bharat Bond ETF April 2031", yahoo: "EBBETF0431.NS", region: "india", currency: "INR", unit: "currency", group: "Indian bond ETFs" },
  { symbol: "EBBETF0433", name: "Bharat Bond ETF April 2033", yahoo: "EBBETF0433.NS", region: "india", currency: "INR", unit: "currency", group: "Indian bond ETFs" },
];

/** Yahoo symbols for the Indian indices tracked in lib/data/instruments/indices.ts. */
export const INDIAN_INDEX_YAHOO: Record<string, string> = {
  NIFTY: "^NSEI",
  SENSEX: "^BSESN",
  BANKNIFTY: "^NSEBANK",
  NIFTYIT: "^CNXIT",
  NIFTYPHARMA: "^CNXPHARMA",
  NIFTYMETAL: "^CNXMETAL",
  NIFTYFMCG: "^CNXFMCG",
  NIFTYNEXT50: "^NSMIDCP",
};
