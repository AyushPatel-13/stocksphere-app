const API_KEY =
  process.env.FINNHUB_API_KEY;

const BASE_URL =
  "https://finnhub.io/api/v1";

export async function getCompanyProfile(
  symbol: string
) {
  console.log(
    "Finnhub Key:",
    API_KEY
  );

  const response = await fetch(
    `${BASE_URL}/stock/profile2?symbol=${symbol}&token=${API_KEY}`,
    {
      cache: "no-store",
    }
  );

  const data = await response.json();

  console.log(
    "Finnhub Response:",
    data
  );

  return data;
}

export async function getCompanyNews(symbol: string) {
  const today = new Date();

  const from = new Date();
  from.setDate(today.getDate() - 7);

  const response = await fetch(
    `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${from
      .toISOString()
      .split("T")[0]}&to=${today
      .toISOString()
      .split("T")[0]}&token=${process.env.FINNHUB_API_KEY}`,
    {
      cache: "no-store",
    }
  );

  const data = await response.json();

  console.log("Finnhub News:", data);

  return data;
}