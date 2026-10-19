import type { LiveQuote } from "./useQuotes";

/** A portfolio row as lib/portfolio.ts returns it from Supabase. */
export type HoldingRow = {
  id: string;
  symbol: string;
  quantity: number | string;
  buy_price: number | string;
};

export type HoldingView = {
  id: string;
  symbol: string;
  quantity: number;
  avgPrice: number;
  invested: number;
  quote: LiveQuote | null;
  current: number | null;
  pnl: number | null;
  pnlPercent: number | null;
  dayChange: number | null;
};

export type CurrencySummary = {
  currency: string;
  current: number;
  invested: number;
  pnl: number;
  pnlPercent: number | null;
  dayChange: number | null;
  dayChangePercent: number | null;
};

/**
 * Per-holding figures from a row and its live quote.
 *
 * A holding with no quote keeps its invested amount (that comes from the user's
 * own numbers) but has no current value, P/L or 1D change — nothing is
 * computed out of a price nobody could source.
 */
export function toHoldingView(
  row: HoldingRow,
  quote: LiveQuote | null
): HoldingView {
  const quantity = Number(row.quantity);
  const avgPrice = Number(row.buy_price);
  const invested = quantity * avgPrice;

  if (!quote) {
    return {
      id: row.id,
      symbol: String(row.symbol).toUpperCase(),
      quantity,
      avgPrice,
      invested,
      quote: null,
      current: null,
      pnl: null,
      pnlPercent: null,
      dayChange: null,
    };
  }

  const current = quote.price * quantity;
  const pnl = current - invested;

  return {
    id: row.id,
    symbol: String(row.symbol).toUpperCase(),
    quantity,
    avgPrice,
    invested,
    quote,
    current,
    pnl,
    pnlPercent: invested > 0 ? (pnl / invested) * 100 : null,
    dayChange: quote.change !== null ? quote.change * quantity : null,
  };
}

/**
 * Portfolio totals, one per currency.
 *
 * Rupees and dollars are never added together and no exchange rate is
 * invented. Totals are only meaningful when every holding is priced, so the
 * caller gets `unpriced` and must not present a partial total as the whole.
 * The 1D figure is null for a currency where any holding lacks a 1D change.
 */
export function summariseHoldings(views: HoldingView[]): {
  totals: CurrencySummary[];
  unpriced: number;
} {
  const groups = new Map<string, { current: number; invested: number; day: number; dayKnown: boolean }>();
  let unpriced = 0;

  for (const view of views) {
    if (!view.quote || view.current === null) {
      unpriced++;
      continue;
    }

    const group = groups.get(view.quote.currency) ?? {
      current: 0,
      invested: 0,
      day: 0,
      dayKnown: true,
    };

    group.current += view.current;
    group.invested += view.invested;

    if (view.dayChange === null) group.dayKnown = false;
    else group.day += view.dayChange;

    groups.set(view.quote.currency, group);
  }

  const totals = Array.from(groups.entries()).map(([currency, group]) => {
    const pnl = group.current - group.invested;
    const previous = group.current - group.day;

    return {
      currency,
      current: group.current,
      invested: group.invested,
      pnl,
      pnlPercent: group.invested > 0 ? (pnl / group.invested) * 100 : null,
      dayChange: group.dayKnown ? group.day : null,
      dayChangePercent:
        group.dayKnown && previous > 0 ? (group.day / previous) * 100 : null,
    };
  });

  return { totals, unpriced };
}
