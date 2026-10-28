import type { AssetQuote } from "../types/quote";

/**
 * Prices as the API sends them: 2 decimals from 1 up, 6 significant figures
 * below (a crypto or penny price), so float noise like 54275.3984375 never
 * reaches a response. The same rule as paper fills (lib/paper/service.ts).
 * Non-finite values pass through for the caller to treat as missing.
 */
export function roundPrice(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.abs(value) >= 1 || value === 0 ? Math.round(value * 100) / 100 : Number(value.toPrecision(6));
}

/** A percentage to 2 decimals. */
export function roundPercent(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : value;
}

const PRICE_FIELDS = ["price", "change", "open", "high", "low", "previousClose"] as const;

/** A quote with its prices and percentage rounded; volume and labels untouched. */
export function roundQuote<T extends AssetQuote>(quote: T): T {
  const out: T = { ...quote };
  const prices: AssetQuote = out;
  for (const field of PRICE_FIELDS) {
    const value = prices[field];
    if (typeof value === "number") prices[field] = roundPrice(value);
  }
  if (typeof out.changePercent === "number") out.changePercent = roundPercent(out.changePercent);
  return out;
}
