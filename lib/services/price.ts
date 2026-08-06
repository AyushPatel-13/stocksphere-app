import { fetchPrice } from "../providers/price";
import { StockPrice } from "../types/price";

export async function getPrice(
  symbol: string
): Promise<StockPrice | null> {
  const result = await fetchPrice(symbol);

  if (!result) {
    return null;
  }

  return result.data;
}