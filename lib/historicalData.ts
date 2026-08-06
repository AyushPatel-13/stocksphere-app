const API_KEY =
  process.env.TWELVE_DATA_API_KEY;

export async function getHistoricalData(
  symbol: string,
  interval: string = "1day"
) {
  const response = await fetch(
    `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=30&apikey=${API_KEY}`,
    {
      cache: "no-store",
    }
  );

  return response.json();
}