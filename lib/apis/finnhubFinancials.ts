const API_KEY = process.env.FINNHUB_API_KEY;

export async function getFinancialMetrics(
  symbol: string
) {
  const response = await fetch(
    `https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${API_KEY}`,
    {
      cache: "no-store",
    }
  );

  return response.json();
}