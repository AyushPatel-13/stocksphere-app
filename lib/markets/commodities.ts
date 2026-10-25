import type { CommodityCategory, QuoteUnit } from "../data/commodities";

/**
 * Pure helpers for showing MCX commodity futures, shared by the server
 * service (lib/services/commodities.ts) and the Commodities pages.
 */

export function filterByCategory<T extends { category: CommodityCategory }>(rows: T[], category: CommodityCategory | "All"): T[] {
  return category === "All" ? rows : rows.filter((row) => row.category === category);
}

/** "per bbl", "per 10 g". */
export function quoteUnitLabel(quote: QuoteUnit): string {
  return quote.size === 1 ? `per ${quote.unit}` : `per ${quote.size} ${quote.unit}`;
}

function amount(value: number, unit: string): string {
  return `${value.toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${unit}`;
}

/** One lot's size, from Upstox's multiplier: GOLD 100 × 10 g → "1 kg". Null if unknown. */
export function lotLabel(quote: QuoteUnit, qtyMultiplier: number | null): string | null {
  if (qtyMultiplier === null || qtyMultiplier <= 0) return null;
  const total = qtyMultiplier * quote.size;
  if (quote.unit === "g" && total >= 1000) return amount(total / 1000, "kg");
  if (quote.unit === "kg" && total >= 1000) return amount(total / 1000, "tonne");
  return amount(total, quote.unit);
}

/** "19 Nov 2026" from "2026-11-19". */
export function formatExpiry(expiry: string): string {
  const date = new Date(`${expiry}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? expiry
    : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "Nov 26" contract month label from an expiry. */
export function contractMonth(expiry: string): string {
  const date = new Date(`${expiry}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? expiry
    : date.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
}


/** "1,17,371 lots" — MCX volume and open interest are counted in lots. */
export function formatLots(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("en-IN")} ${value === 1 ? "lot" : "lots"}`;
}

/** "23 Oct, 23:29 IST" for a quote's last trade. */
export function formatTradeTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const text = date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Kolkata",
  });
  return `${text} IST`;
}

/** The freshness badge for a quote: what kind of number the reader is looking at. */
export function freshnessLabel(
  quote: { status: "live" | "last_trade" | "no_trades"; lastTradeTime: string | null } | null
): { label: string; tone: "live" | "stale" | "none" } {
  if (!quote) return { label: "Quote unavailable", tone: "none" };
  if (quote.status === "no_trades") return { label: "No trades yet", tone: "none" };
  if (quote.status === "live") return { label: "Live", tone: "live" };
  const time = formatTradeTime(quote.lastTradeTime);
  return { label: time ? `Last trade ${time}` : "Last traded price", tone: "stale" };
}
