import { getFinancialMetrics } from "../apis/finnhubFinancials";

export async function getFinancials(
  symbol: string
) {
  const data =
    await getFinancialMetrics(symbol);

  if (!data?.metric) return null;

  return {
    marketCap:
      data.metric.marketCapitalization,

    pe:
      data.metric.peTTM,

    eps:
      data.metric.epsTTM,

    dividendYield:
      data.metric.dividendYieldIndicatedAnnual,

    week52High:
      data.metric["52WeekHigh"],

    week52Low:
      data.metric["52WeekLow"],

    roe:
      data.metric.roeTTM,
  };
}