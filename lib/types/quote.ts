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

  lastUpdated?: string;
}