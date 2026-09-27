const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;

export async function getStockQuote(symbol: string) {
  try {
    const response = await fetch(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(
        symbol
      )}&apikey=${API_KEY}`,
      {
        cache: "no-store",
      }
    );

    const data = await response.json();

    console.log(`Alpha Response [${symbol}]:`, data);

    return data;
  } catch (error) {
    console.error(`Alpha Vantage Error [${symbol}]:`, error);

    return null;
  }
}

export async function getCompanyOverview(symbol: string) {
  try {
    const response = await fetch(
      `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(
        symbol
      )}&apikey=${API_KEY}`,
      {
        cache: "no-store",
      }
    );

    const data = await response.json();

    console.log(`Alpha Overview [${symbol}]:`, data);

    return data;
  } catch (error) {
    console.error(`Alpha Overview Error [${symbol}]:`, error);

    return null;
  }
}