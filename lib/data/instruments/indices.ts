/**
 * The market indices StockSphere tracks, and where each one is priced.
 *
 * Indian indices are priced by Upstox, keyed by their Upstox instrument key.
 * Global indices are priced by Yahoo Finance, keyed by their Yahoo ticker:
 * Upstox only lists NSE/BSE instruments, so a "GLOBAL_INDEX|^DJI" key is not
 * something it can answer, and sending one alongside the Indian keys put the
 * whole Upstox request at risk.
 */
type IndexBase = {
  name: string;
  symbol: string;
};

export type IndianMarketIndex = IndexBase & {
  category: "indian";
  instrumentKey: string;
};

export type GlobalMarketIndex = IndexBase & {
  category: "global";
  yahooSymbol: string;
};

export type MarketIndex = IndianMarketIndex | GlobalMarketIndex;

export const INDIAN_INDICES: IndianMarketIndex[] = [
  {
    name: "NIFTY 50",
    symbol: "NIFTY",
    instrumentKey: "NSE_INDEX|Nifty 50",
    category: "indian",
  },
  {
    name: "SENSEX",
    symbol: "SENSEX",
    instrumentKey: "BSE_INDEX|SENSEX",
    category: "indian",
  },
  {
    name: "NIFTY BANK",
    symbol: "BANKNIFTY",
    instrumentKey: "NSE_INDEX|Nifty Bank",
    category: "indian",
  },
  {
    name: "NIFTY IT",
    symbol: "NIFTYIT",
    instrumentKey: "NSE_INDEX|Nifty IT",
    category: "indian",
  },
  {
    name: "NIFTY PHARMA",
    symbol: "NIFTYPHARMA",
    instrumentKey: "NSE_INDEX|Nifty Pharma",
    category: "indian",
  },
  {
    name: "NIFTY METAL",
    symbol: "NIFTYMETAL",
    instrumentKey: "NSE_INDEX|Nifty Metal",
    category: "indian",
  },
  {
    name: "NIFTY FMCG",
    symbol: "NIFTYFMCG",
    instrumentKey: "NSE_INDEX|Nifty FMCG",
    category: "indian",
  },
  {
    name: "NIFTY NEXT 50",
    symbol: "NIFTYNEXT50",
    instrumentKey: "NSE_INDEX|Nifty Next 50",
    category: "indian",
  },
];

export const GLOBAL_INDICES: GlobalMarketIndex[] = [
  {
    name: "DOW JONES",
    symbol: "DOW",
    yahooSymbol: "^DJI",
    category: "global",
  },
  {
    name: "S&P 500",
    symbol: "SPX",
    yahooSymbol: "^GSPC",
    category: "global",
  },
  {
    name: "NASDAQ 100",
    symbol: "NASDAQ100",
    yahooSymbol: "^NDX",
    category: "global",
  },
  {
    name: "NIKKEI 225",
    symbol: "NIKKEI",
    yahooSymbol: "^N225",
    category: "global",
  },
  {
    name: "HANG SENG",
    symbol: "HANGSENG",
    yahooSymbol: "^HSI",
    category: "global",
  },
  {
    name: "DAX",
    symbol: "DAX",
    yahooSymbol: "^GDAXI",
    category: "global",
  },
  {
    name: "FTSE 100",
    symbol: "FTSE",
    yahooSymbol: "^FTSE",
    category: "global",
  },
  {
    name: "CAC 40",
    symbol: "CAC40",
    yahooSymbol: "^FCHI",
    category: "global",
  },
];

export const ALL_INDICES: MarketIndex[] = [
  ...INDIAN_INDICES,
  ...GLOBAL_INDICES,
];
