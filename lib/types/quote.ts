export interface AssetQuote {
  symbol: string;

  price: number;

  change?: number;

  changePercent?: number;

  open?: number;

  high?: number;

  low?: number;

  previousClose?: number;

  volume?: number;

  currency?: string;

  /** When the price was set by the market (ISO), not when it was fetched. */
  lastUpdated?: string;

  /** Which provider answered, e.g. "Upstox" or "Yahoo (fallback, may be delayed)". */
  source?: string;
}