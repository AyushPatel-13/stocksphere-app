"use client";

import { useEffect, useState } from "react";

import type { AssetQuote } from "@/lib/types/quote";

/**
 * The /api/market overview (four US and four Indian large caps) as a flat,
 * named list. Screener and Heatmap read the same payload the Home page's
 * "US Markets" row does, so no new provider calls are introduced.
 */

export type OverviewQuote = {
  symbol: string;
  name: string;
  market: "US" | "India";
  price: number;
  change: number | null;
  changePercent: number | null;
  currency: string;
};

export type MarketOverviewState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; quotes: OverviewQuote[] };

const NAMES: Record<string, string> = {
  AAPL: "Apple",
  MSFT: "Microsoft",
  TSLA: "Tesla",
  NVDA: "NVIDIA",
  RELIANCE: "Reliance Industries",
  TCS: "Tata Consultancy Services",
  HDFCBANK: "HDFC Bank",
  INFY: "Infosys",
};

function toOverviewQuote(
  quote: AssetQuote | null | undefined,
  market: OverviewQuote["market"]
): OverviewQuote | null {
  if (!quote || typeof quote.price !== "number" || !(quote.price > 0)) {
    return null;
  }

  const symbol = String(quote.symbol || "").toUpperCase();
  if (!symbol) return null;

  return {
    symbol,
    name: NAMES[symbol] ?? symbol,
    market,
    price: quote.price,
    change: typeof quote.change === "number" ? quote.change : null,
    changePercent:
      typeof quote.changePercent === "number" ? quote.changePercent : null,
    currency: quote.currency || (market === "India" ? "INR" : "USD"),
  };
}

export function useMarketOverview(): MarketOverviewState {
  const [state, setState] = useState<MarketOverviewState>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;

    fetch("/api/market")
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;

        const us = Object.values(
          (data?.us ?? {}) as Record<string, AssetQuote | null>
        ).map((quote) => toOverviewQuote(quote, "US"));

        const india = ((data?.india ?? []) as AssetQuote[]).map((quote) =>
          toOverviewQuote(quote, "India")
        );

        const quotes = [...us, ...india].filter(
          (quote): quote is OverviewQuote => quote !== null
        );

        setState(
          quotes.length > 0 ? { status: "ready", quotes } : { status: "error" }
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export function formatQuotePrice(price: number, currency: string) {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(price);
}

export function formatSignedPercent(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
