import { Asset } from "../types/asset";

export async function getAsset(
  symbol: string
): Promise<Asset | null> {

  // Temporary

  return {
    symbol,

    name: symbol,

    type: "stock",

    exchange: "",

    currency: "USD",
  };
}