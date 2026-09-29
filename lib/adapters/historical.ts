import { HistoricalPayload, HistoricalValueRow } from "../types/historical";

/**
 * One raw Upstox candle.
 *
 * Upstox returns candles as ARRAYS, not objects. Live shape, verified across
 * TCS, INFY, RELIANCE and HDFCBANK:
 *
 *   ["2026-09-25T00:00:00+05:30", 2054, 2090.2, 2038.1, 2082, 3342195, 0]
 *    timestamp                    open  high   low    close volume   oi
 *
 * Declared as `unknown[]` because this is an upstream response we do not
 * control; every slot below is validated before it is used.
 */
export type UpstoxCandleRow = unknown[];

const CANDLE_DATE = 0;
const CANDLE_OPEN = 1;
const CANDLE_HIGH = 2;
const CANDLE_LOW = 3;
const CANDLE_CLOSE = 4;
const CANDLE_VOLUME = 5;

// Slot 6 is Upstox's open interest. It is deliberately never read here: the
// {values:[...]} contract has no field for it, so it must not reach the payload.
// lib/apis/upstoxHistorical.ts already drops it at the network boundary; this is
// the second, independent guarantee.

/**
 * How many slots a row must have to be a usable candle: through CLOSE.
 *
 * Volume is deliberately not part of this test. A row truncated after close is
 * still a complete OHLC point, and volume is read as "not reported" (null)
 * rather than being allowed to invalidate otherwise good prices — the same rule
 * lib/agent/normalizers/historical.ts applies. A row shorter than this has no
 * close and is discarded rather than padded with undefined.
 *
 * Note this is 5 while lib/apis/upstoxHistorical.ts requires 6: the client
 * COPIES slots 0-5, so it needs all six to exist, whereas this adapter READS
 * OHLC from 1-4 and treats volume as optional.
 */
const CANDLE_MIN_FIELDS = 5;

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const num = Number(value);

  return Number.isFinite(num) ? num : null;
}

/**
 * Convert a Upstox candle timestamp to YYYY-MM-DD.
 *
 * Upstox sends ISO 8601 in IST, e.g. "2026-09-25T00:00:00+05:30", while both
 * consumers want a plain date: StockChart prints `item.datetime` directly as
 * the x-axis label, and NormalizedHistoricalPoint.date is documented as
 * YYYY-MM-DD. Only the date part is kept — the time is always midnight IST and
 * carries no information.
 *
 * Returns null for anything that is not a real calendar date, so an unusable
 * row is dropped rather than rendered as "NaN-NaN-NaN" or "". The empty-string
 * answer would otherwise be indistinguishable from a missing date.
 */
export function parseUpstoxCandleDate(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  // Accepts both the full timestamp Upstox sends and a bare date, but nothing
  // else: "2026-09-25", "2026-09-25T00:00:00+05:30" pass; "25-09-2026" and
  // "2026/09/25" do not.
  const match = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(trimmed);

  if (!match) return null;

  const date = match[1];

  const parsed = new Date(`${date}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime())) return null;

  // The parser is not strict enough on its own. For a date-TIME string V8
  // accepts an impossible day such as 2026-02-30 and silently rolls it forward
  // to 2026-03-02 rather than rejecting it, so the value is read back and
  // compared. A candle dated to a day that does not exist would otherwise be
  // plotted and sorted as if it did.
  if (parsed.toISOString().slice(0, 10) !== date) return null;

  return date;
}

/**
 * Map Upstox candles onto the {values:[...]} payload the rest of the app
 * already consumes.
 *
 * Three rules, each of which a consumer depends on:
 *
 *  1. NEWEST-FIRST. Upstox already answers in that order (verified live for all
 *     four sampled symbols), and the result is sorted descending anyway so the
 *     guarantee survives an upstream change. StockChart does
 *     slice(0, days).reverse(): it takes the first N rows assuming they are the
 *     most recent, then inverts the array assuming it received newest-first.
 *     Handing it ascending rows would silently render every chart backwards
 *     rather than fail, which is why this is enforced instead of trusted.
 *  2. YYYY-MM-DD datetimes, never the raw IST ISO string.
 *  3. No open interest, and no other upstream field: rows are built from the
 *     six known slots only.
 *
 * A row is dropped when it cannot yield a complete OHLC point on a real date.
 * An incomplete candle is not a data point, and filling it with 0 would draw a
 * spike to the bottom of the chart — the same rule the agent normalizer
 * applies. Volume is NOT part of that validity test: a missing volume becomes
 * null ("not reported") rather than invalidating otherwise good OHLC.
 */
export function normalizeUpstoxCandles(
  rows: UpstoxCandleRow[] | null | undefined
): HistoricalPayload {
  if (!Array.isArray(rows)) {
    return { values: [] };
  }

  const seenDates = new Set<string>();
  const values: HistoricalValueRow[] = [];

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < CANDLE_MIN_FIELDS) continue;

    const datetime = parseUpstoxCandleDate(row[CANDLE_DATE]);

    if (datetime === null) continue;
    if (seenDates.has(datetime)) continue;

    const open = toNumberOrNull(row[CANDLE_OPEN]);
    const high = toNumberOrNull(row[CANDLE_HIGH]);
    const low = toNumberOrNull(row[CANDLE_LOW]);
    const close = toNumberOrNull(row[CANDLE_CLOSE]);

    if (
      open === null ||
      high === null ||
      low === null ||
      close === null
    ) {
      continue;
    }

    // Marked only once the row is known to be usable, so a discarded row never
    // blocks a later valid row carrying the same date.
    seenDates.add(datetime);

    values.push({
      datetime,
      open,
      high,
      low,
      close,
      volume: toNumberOrNull(row[CANDLE_VOLUME]),
    });
  }

  // Descending by date. YYYY-MM-DD sorts correctly as a plain string, which is
  // also how lib/agent/normalizers/historical.ts sorts it ascending.
  values.sort((a, b) => b.datetime.localeCompare(a.datetime));

  return { values };
}
