import { fetchCompany } from "../providers/company";

export async function getCompany(
  symbol: string
) {
  const result =
    await fetchCompany(symbol);

  if (!result) return null;

  return result.data;
}