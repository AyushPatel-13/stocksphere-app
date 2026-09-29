import { fetchFinancials } from "../providers/financials";

export async function getFinancials(
  symbol: string
) {
  const result =
    await fetchFinancials(symbol);

  if (!result) return null;

  return result.data;
}
