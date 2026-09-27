const ACCESS_TOKEN = process.env.UPSTOX_ACCESS_TOKEN;

export async function getUpstoxQuotes(
  instrumentKeys: string[]
) {
  if (!ACCESS_TOKEN) {
    throw new Error(
      "UPSTOX_ACCESS_TOKEN is missing from environment variables"
    );
  }

  const instruments = instrumentKeys.join(",");

  try {
    const response = await fetch(
      `https://api.upstox.com/v3/market-quote/quotes?instrument_key=${encodeURIComponent(
        instruments
      )}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        `Upstox API Error ${response.status}:`,
        errorText
      );

      return null;
    }

    const data = await response.json();

    console.log("Upstox Response:", data);

    return data;
  } catch (error) {
    console.error("Upstox Request Error:", error);

    return null;
  }
}

export async function searchUpstoxEquity(
  symbol: string
) {
  if (!ACCESS_TOKEN) {
    throw new Error(
      "UPSTOX_ACCESS_TOKEN is missing from environment variables"
    );
  }

  try {
    const params = new URLSearchParams({
      query: symbol,
      exchanges: "NSE",
      segments: "EQ",
      instrument_types: "EQ",
      page_number: "1",
      records: "30",
    });

    const response = await fetch(
      `https://api.upstox.com/v2/instruments/search?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        `Upstox Instrument Search Error ${response.status}:`,
        errorText
      );

      return null;
    }

    const data = await response.json();

    const instrument = data?.data?.find(
      (item: {
        segment?: string;
        instrument_type?: string;
        trading_symbol?: string;
        instrument_key?: string;
      }) =>
        item.segment === "NSE_EQ" &&
        item.instrument_type === "EQ" &&
        item.trading_symbol?.toUpperCase() ===
          symbol.toUpperCase()
    );

    return instrument ?? null;
  } catch (error) {
    console.error(
      `Upstox Instrument Search Error [${symbol}]:`,
      error
    );

    return null;
  }
}