import { getHistoricalData } from "../apis/twelvedata";

export async function fetchHistorical(
  symbol: string
) {
  try {
    const historical =
      await getHistoricalData(symbol);

    if (historical?.values) {
      console.log("✅ Twelve Historical");

      return {
        provider: "TwelveData",
        data: historical,
      };
    }
  } catch {}

  return null;
}