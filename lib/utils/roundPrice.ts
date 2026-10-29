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

/**
 * A change, at the precision of the price it belongs to: 2 decimals for a
 * price of 1 or more (CAC 40's −0.180176 is −0.18), the sub-1 rule only for a
 * sub-1 price, whose moves really are that small. Without a price, 2 decimals.
 */
export function roundChange(value: number, price?: number | null): number {
  if (!Number.isFinite(value)) return value;
  if (typeof price === "number" && Number.isFinite(price) && Math.abs(price) < 1 && price !== 0) {
    return Number(value.toPrecision(6));
  }
  return Math.round(value * 100) / 100;
}

/** A percentage to 2 decimals. */
export function roundPercent(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : value;
}

/** A yield or rate (a value in %, such as a Treasury yield) to 3 decimals. */
export function roundRate(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value;
}

const PRICE_FIELDS = ["price", "open", "high", "low", "previousClose"] as const;

/** A quote with its prices and percentage rounded; volume and labels untouched. */
export function roundQuote<T extends AssetQuote>(quote: T): T {
  const out: T = { ...quote };
  const prices: AssetQuote = out;
  for (const field of PRICE_FIELDS) {
    const value = prices[field];
    if (typeof value === "number") prices[field] = roundPrice(value);
  }
  if (typeof out.change === "number") out.change = roundChange(out.change, quote.price);
  if (typeof out.changePercent === "number") out.changePercent = roundPercent(out.changePercent);
  return out;
}

// Fields a market response carries prices in. Anything else (volume, market
// cap, counts, timestamps, ids) is left exactly as it is.
const PRICE_KEYS = new Set([
  "price", "open", "high", "low", "close", "previousClose", "lastPrice", "ltp",
  "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "dayHigh", "dayLow",
]);
const PERCENT_KEY = /(?:Percent|Pct)$/;

/**
 * A whole response body with every price, change and percentage rounded, by
 * field name, at any depth. A row with `unit: "percent"` (a yield) keeps 3
 * decimals for its value and change. Returns a copy; the input is not changed.
 */
export function roundMarketPayload<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => roundMarketPayload(item)) as T;
  if (!value || typeof value !== "object") return value;

  const row = value as Record<string, unknown>;
  const isRate = row.unit === "percent";
  const price = typeof row.price === "number" ? row.price : null;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(row)) {
    if (typeof field !== "number") out[key] = roundMarketPayload(field);
    else if (PERCENT_KEY.test(key)) out[key] = roundPercent(field);
    else if (key === "change") out[key] = isRate ? roundRate(field) : roundChange(field, price);
    else if (PRICE_KEYS.has(key)) out[key] = isRate ? roundRate(field) : roundPrice(field);
    else out[key] = field;
  }
  return out as T;
}
