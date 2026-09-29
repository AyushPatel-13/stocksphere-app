/**
 * The raw historical payload every provider path must produce.
 *
 * This is deliberately the *provider* shape and not the agent shape, because
 * two existing consumers read it and neither is being changed:
 *
 *   app/stock/[symbol]/page.tsx:202   historical?.values || []
 *   components/Stock/StockChart.tsx   .slice(0, days).reverse()
 *                                     .map(item => ({ time: item.datetime,
 *                                                     price: Number(item.close) }))
 *
 * StockChart is the strict consumer: it slices from the FRONT and then
 * reverses, so `values` must be NEWEST-FIRST and every row must carry a string
 * `datetime` plus a `close` that Number() can read. The agent normalizer
 * (lib/agent/normalizers/historical.ts) reads the same payload but re-sorts it
 * ascending itself, so it is order-agnostic.
 */
export interface HistoricalValueRow {
  /** YYYY-MM-DD. StockChart plots this verbatim as the chart's axis label. */
  datetime: string;
  /**
   * `number | string` because the two providers genuinely disagree: TwelveData
   * returns numeric strings ("2082.00000") and lib/adapters/historical.ts
   * returns real numbers. Both consumers coerce (Number(item.close),
   * toNumberOrNull), so this union is the honest description of what is in
   * flight rather than a coercion hidden at the boundary.
   */
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string | null;
}

export interface HistoricalPayload {
  /** Newest-first. See the note above — StockChart depends on this order. */
  values: HistoricalValueRow[];
}

/**
 * The ranges get_historical accepts.
 *
 * Single source of truth on purpose: the tool's runtime validator, the JSON
 * Schema enum handed to the LLM, and lib/providers/historical.ts's date windows
 * all read this one tuple, so the three cannot drift apart.
 *
 * Note "max" is a bounded request, not an unlimited one — see
 * lib/providers/historical.ts, where it maps to the earliest history Upstox
 * will actually serve.
 */
export const HISTORICAL_RANGES = ["1m", "3m", "6m", "1y", "max"] as const;

export type HistoricalRange = (typeof HISTORICAL_RANGES)[number];
