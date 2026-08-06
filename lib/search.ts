export async function searchStocks(
  query: string
) {
  const stocks = [
    {
      symbol: "AAPL",
      shortname: "Apple Inc.",
    },
    {
      symbol: "TSLA",
      shortname: "Tesla Inc.",
    },
    {
      symbol: "MSFT",
      shortname: "Microsoft",
    },
    {
      symbol: "RELIANCE.NS",
      shortname: "Reliance Industries",
    },
    {
      symbol: "TCS.NS",
      shortname: "TCS",
    },
  ];

  return stocks.filter(
    (stock) =>
      stock.symbol
        .toLowerCase()
        .includes(query.toLowerCase()) ||
      stock.shortname
        .toLowerCase()
        .includes(query.toLowerCase())
  );
}