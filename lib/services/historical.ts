import { fetchHistorical } from "../providers/historical";

export async function getHistorical(
  symbol: string
) {
  const result =
    await fetchHistorical(symbol);

  return result?.data;
}