const API_KEY = process.env.TWELVE_DATA_API_KEY;

export async function getStockQuote(symbol: string) {
  // The API key is deliberately never logged. It used to be, on every call.
  const response = await fetch(
    `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(
      symbol
    )}&apikey=${API_KEY}`,
    {
      cache: "no-store",
    }
  );

  const data = await response.json();

  console.log("Twelve Response:", data);

  return data;
}

export async function getHistoricalData(symbol: string) {
  const response = await fetch(
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
      symbol
    )}&interval=1day&outputsize=365&apikey=${API_KEY}`,
    {
      cache: "no-store",
    }
  );

  const data = await response.json();

  console.log("Historical Response:", data);

  return data;
}