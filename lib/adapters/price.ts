import { StockPrice } from "../types/price";

export function normalizeFinnhubPrice(data: any): StockPrice {
  return {
    price: data.c,
    change: data.d,
    changePercent: data.dp,
    open: data.o,
    high: data.h,
    low: data.l,
    previousClose: data.pc,
    volume: 0,
    currency: "USD",
  };
}

export function normalizeYahooPrice(data: any): StockPrice {
  return {
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


export function normalizeTwelvePrice(data: any): StockPrice {
  return {
    price: Number(data.close),
    change: Number(data.change),
    changePercent: Number(data.percent_change),
    open: Number(data.open),
    high: Number(data.high),
    low: Number(data.low),
    previousClose: Number(data.previous_close),
    volume: Number(data.volume),
    currency: data.currency,
  };
}