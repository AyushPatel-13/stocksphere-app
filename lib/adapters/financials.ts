import { FinancialMetrics } from "../agent/types";

/**
 * The one ratio this step maps onto the contract. Matched by name, never by
 * array position: the endpoint's ordering is not part of its contract.
 */
const PE_RATIO_NAME = "P/E";

/**
 * A key-ratios row, narrowed to the two fields this adapter reads. Declared
 * structurally so a test fixture does not need the full UpstoxKeyRatio shape.
 */
export interface UpstoxKeyRatioRow {
  name?: unknown;
  company_value?: unknown;
}

/**
 * Convert a Upstox ratio value to a plain finite number, or null.
 *
 * Upstox returns values as strings, and some carry a unit suffix
 * (e.g. "45.89%"). A blank, absent or non-numeric value becomes null rather
 * than 0 or NaN.
 */
export function parseUpstoxRatioValue(
  value: unknown
): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  // Drop a trailing unit suffix before the numeric parse.
  const numeric = trimmed.endsWith("%")
    ? trimmed.slice(0, -1).trim()
    : trimmed;

  const parsed = Number(numeric);

  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Look a ratio up by exact name and return its company value as a number.
 *
 * `rows` is tolerated as null/undefined/non-array so a provider failure
 * degrades to null instead of throwing.
 */
export function findUpstoxRatioValue(
  rows: UpstoxKeyRatioRow[] | null | undefined,
  name: string
): number | null {
  if (!Array.isArray(rows)) {
    return null;
  }

  const match = rows.find(
    (row) =>
      !!row &&
      typeof row.name === "string" &&
      row.name.trim() === name
  );

  if (!match) {
    return null;
  }

  return parseUpstoxRatioValue(match.company_value);
}

/**
 * Map Upstox key-ratios onto FinancialMetrics.
 *
 * Only `pe` is populated. Every other field is null, and each for a reason:
 *
 *  - `marketCap`: Upstox reports crore INR in
 *    profile.sector_market_cap_inr, while the contract carries no unit or
 *    currency metadata and the Finnhub path supplies millions of the local
 *    currency. Writing it here would silently mix units (10x) and currencies,
 *    so it stays null.
 *  - `eps`, `dividendYield`, `week52High`, `week52Low`: not exposed by the
 *    Upstox fundamentals endpoints at all.
 *  - `roe`: Upstox does return "ROE", but it is not enabled in this step.
 */
export function normalizeUpstoxFinancials(
  rows: UpstoxKeyRatioRow[] | null | undefined
): FinancialMetrics {
  return {
    marketCap: null,

    pe: findUpstoxRatioValue(rows, PE_RATIO_NAME),

    eps: null,

    dividendYield: null,

    week52High: null,

    week52Low: null,

    roe: null,
  };
}
