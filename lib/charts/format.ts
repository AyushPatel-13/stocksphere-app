import type { ValueUnit } from "../data/assets";

/**
 * One rule for writing any value on a chart or an asset page:
 *   currency  ₹2,456.10 for INR (Indian digit grouping), $763.25 for USD
 *   points    23,012.05 (indices — not money)
 *   percent   5.098% (bond yields)
 * Very small prices (crypto like SHIB) keep enough significant digits.
 */
export function formatValue(
  value: number | null | undefined,
  unit: ValueUnit,
  currency: string | null
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";

  if (unit === "percent") return `${value.toFixed(3)}%`;

  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 1 ? Math.min(8, Math.max(2, 2 - Math.floor(Math.log10(abs)) + 2)) : 2;
  const locale = currency === "INR" || unit === "points" ? "en-IN" : "en-US";

  if (unit === "points" || !currency) {
    return value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Compact volume: 1.2Cr / 45.6L for India, 1.2M / 45.6K otherwise. */
export function formatCompactVolume(value: number | null | undefined, indian: boolean): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (indian) {
    if (value >= 1e7) return `${(value / 1e7).toFixed(2)}Cr`;
    if (value >= 1e5) return `${(value / 1e5).toFixed(2)}L`;
    return value.toLocaleString("en-IN");
  }
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}
