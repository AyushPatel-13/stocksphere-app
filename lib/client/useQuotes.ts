"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Live quotes for a set of symbols, one /api/market?symbol= request each.
 *
 * Shared by Holdings, Watchlist and Explore's "Your investments" so every page
 * applies the same rule: only a positive, finite price counts. Anything else —
 * a failed request, a 404, a zero — is `null` and renders as unavailable. It is
 * never replaced by a stale or invented number.
 */

export type LiveQuote = {
  price: number;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  currency: string;
};

export type QuotesState = {
  loading: boolean;
  /** Keyed by upper-case symbol; `null` means "could not be priced". */
  quotes: Record<string, LiveQuote | null>;
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function fetchQuote(symbol: string, retry = true): Promise<LiveQuote | null> {
  // A page asks for many quotes at once and a provider occasionally refuses
  // one, so a failure gets one more try. 404 is included: for an Indian symbol
  // /api/market answers 404 when Upstox didn't respond (it never reaches the
  // global chain that tells "unknown" from "unavailable"). 400 — an invalid
  // symbol — is final.
  const again = async () => {
    if (!retry) return null;
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    return fetchQuote(symbol, false);
  };

  try {
    const response = await fetch(
      `/api/market?symbol=${encodeURIComponent(symbol)}`
    );
    if (response.status >= 500 || response.status === 404) return again();
    if (!response.ok) return null;

    const quote = (await response.json())?.quote;
    const price = finite(quote?.price);
    if (price === null || price <= 0) return null;

    return {
      price,
      change: finite(quote?.change),
      changePercent: finite(quote?.changePercent),
      // Providers report a missing volume as 0; that is "unknown", not "none".
      volume: finite(quote?.volume) || null,
      currency: String(quote?.currency || "USD").toUpperCase(),
    };
  } catch {
    return again();
  }
}

export function useQuotes(symbols: string[]): QuotesState {
  // A stable key, so a new array with the same symbols does not refetch.
  const key = useMemo(
    () =>
      Array.from(
        new Set(
          symbols
            .map((symbol) => String(symbol ?? "").trim().toUpperCase())
            .filter(Boolean)
        )
      )
        .sort()
        .join(","),
    [symbols]
  );

  const [state, setState] = useState<QuotesState & { key: string }>({
    key: "",
    loading: false,
    quotes: {},
  });

  useEffect(() => {
    if (!key) return;

    let cancelled = false;

    Promise.all(
      key.split(",").map(async (symbol) => [symbol, await fetchQuote(symbol)] as const)
    ).then((results) => {
      if (!cancelled) {
        setState({ key, loading: false, quotes: Object.fromEntries(results) });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  // Loading is derived rather than set in the effect: any key the state has
  // not caught up with yet is still in flight. The previous quotes stay
  // visible meanwhile, so adding one holding doesn't blank the whole table.
  if (!key) return { loading: false, quotes: {} };

  return { loading: state.key !== key, quotes: state.quotes };
}

/** Indian amounts use Indian digit grouping (₹1,11,769); others en-US. */
export function formatMoney(amount: number, currency: string, signed = false) {
  const formatted = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));

  if (amount < 0) return `-${formatted}`;
  return signed ? `+${formatted}` : formatted;
}

export function formatPercent(value: number | null, signed = true) {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatVolume(value: number | null, currency = "INR") {
  if (value === null) return "—";
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US").format(value);
}
