import { NormalizedHistoricalPoint } from "../types";

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Normalizes whatever lib/services/historical.ts returns (currently a raw
 * TwelveData time_series response, `{ values: [...] }`, newest-first,
 * numeric fields as strings) into a stable, ascending-by-date,
 * fully-numeric shape.
 *
 * A row missing any OHLC field is dropped rather than filled with 0 or a
 * guessed value — an incomplete candle is not a valid data point.
 */
export function normalizeHistorical(raw: unknown): NormalizedHistoricalPoint[] {
  const values = (raw as { values?: unknown } | null | undefined)?.values;
  if (!Array.isArray(values)) return [];

  const seenDates = new Set<string>();
  const points: NormalizedHistoricalPoint[] = [];

  for (const item of values) {
    if (!item || typeof item !== "object") continue;

    const record = item as Record<string, unknown>;
    const date = typeof record.datetime === "string" ? record.datetime.trim() : "";

    const open = toNumberOrNull(record.open);
    const high = toNumberOrNull(record.high);
    const low = toNumberOrNull(record.low);
    const close = toNumberOrNull(record.close);

    if (!date || open === null || high === null || low === null || close === null) {
      continue;
    }
    if (seenDates.has(date)) continue;
    seenDates.add(date);

    points.push({
      date,
      open,
      high,
      low,
      close,
      volume: toNumberOrNull(record.volume),
    });
  }

  points.sort((a, b) => a.date.localeCompare(b.date));

  return points;
}
