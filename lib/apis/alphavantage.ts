const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;

export async function getStockQuote(symbol: string) {
  console.log("Alpha Key:", API_KEY);

  const response = await fetch(
    `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${API_KEY}`,
    {
      cache: "no-store",
    }
  );

  const data = await response.json();

  console.log("Alpha Response:", data);

  return data;
}

export async function getCompanyOverview(
  symbol: string
) {
  const response = await fetch(
    `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${API_KEY}`,
    {
      cache: "no-store",
    }
  );

  const data = await response.json();

  return data;
}