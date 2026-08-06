import { AssetQuote } from "../types/quote";

export function fromYahoo(data: any): AssetQuote {
  return {
    symbol: data.symbol,
    price: data.price,
    change: data.change,
    changePercent: data.changePercent,
    open: data.open,
    high: data.high,
    low: data.low,
    previousClose: data.previousClose,
    volume: data.volume,
    currency: data.currency,
  };
}

export function fromAlphaVantage(data: any): AssetQuote {
  const quote = data?.["Global Quote"];

  return {
    symbol: quote?.["01. symbol"] ?? "",
    price: Number(quote?.["05. price"] ?? 0),
    change: Number(quote?.["09. change"] ?? 0),
    changePercent: Number(
      String(quote?.["10. change percent"] ?? "0").replace("%", "")
    ),
  };
}

export function fromTwelveData(data: any): AssetQuote {
  return {
    symbol: data.symbol,
    price: Number(data.close ?? 0),
    open: Number(data.open ?? 0),
    high: Number(data.high ?? 0),
    low: Number(data.low ?? 0),
    previousClose: Number(data.previous_close ?? 0),
  };
}