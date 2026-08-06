export type AssetType =
  | "stock"
  | "etf"
  | "mutualFund"
  | "index"
  | "crypto"
  | "commodity"
  | "forex"
  | "bond"
  | "option"
  | "future";

export interface Asset {
  symbol: string;

  name: string;

  type: AssetType;

  exchange: string;

  currency: string;

  country?: string;

  logo?: string;
}