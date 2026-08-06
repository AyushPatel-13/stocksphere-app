const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;

export async function getCompanyProfile(
  symbol: string
) {
  const response = await fetch(
    `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${API_KEY}`,
    {
      cache: "no-store",
    }
  );

  return response.json();
}