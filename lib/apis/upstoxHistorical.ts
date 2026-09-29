const ACCESS_TOKEN = process.env.UPSTOX_ACCESS_TOKEN;

/** One daily candle, as Upstox returns it: an array of slots, not an object. */
export type UpstoxCandleRow = unknown[];

/**
 * The slots this client copies: timestamp, open, high, low, close, volume.
 *
 * Upstox sends a seventh slot (open interest). It is dropped here, at the
 * network boundary, so it cannot travel further down the stack at all — the
 * {values:[...]} contract has no field for it. lib/adapters/historical.ts
 * ignores it independently.
 */
const CANDLE_FIELD_COUNT = 6;

/** The only date shape the two path segments below may take. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Daily candles for one NSE instrument, keyed by its Upstox instrument_key
 * (e.g. "NSE_EQ|INE467B01029") — not by ISIN and not by a trading symbol, so
 * the caller must resolve the instrument through searchUpstoxEquity() first.
 *
 * Endpoint notes, all verified live:
 *  - v3 is required. The v2 path .../v2/historical-candle/{key}/1day/... answers
 *    HTTP 400 "Interval accepts one of (1minute,30minute,day,week,month)"; v3
 *    wants the "days/1" form used here.
 *  - The instrument key contains a "|", which is percent-encoded below. Upstox
 *    accepts both spellings; encoding is the correct habit and avoids any
 *    interpretation of "|" as a delimiter.
 *  - The date order is {to_date}/{from_date} — the newest bound comes FIRST.
 *    Swapping them answers HTTP 400.
 *  - Lookback is bounded: a from_date beyond roughly ten years back answers
 *    HTTP 400 "Invalid date range". lib/providers/historical.ts clamps its
 *    window to stay inside that, and this client reports the refusal as null
 *    rather than pretending there are no candles.
 *
 * Returns:
 *  - an array (possibly empty) when Upstox answered successfully. An empty
 *    array means "no candles in that window", which is a real answer.
 *  - null when the request failed or the response was not in the expected
 *    shape, i.e. when we do not know whether there is data.
 * Throws if UPSTOX_ACCESS_TOKEN is missing (same convention as the other
 * Upstox clients).
 */
export async function getUpstoxHistoricalCandles(
  instrumentKey: string,
  fromDate: string,
  toDate: string
): Promise<UpstoxCandleRow[] | null> {
  if (!ACCESS_TOKEN) {
    throw new Error(
      "UPSTOX_ACCESS_TOKEN is missing from environment variables"
    );
  }

  const trimmedKey = instrumentKey.trim();

  // A key or a bound we cannot build a correct request from is "unavailable".
  // Building the URL anyway would ask Upstox a different question than the one
  // the caller intended, and its answer would be silently attributed to them.
  if (!trimmedKey) return null;
  if (!ISO_DATE.test(fromDate) || !ISO_DATE.test(toDate)) return null;
  if (fromDate > toDate) return null;

  try {
    const response = await fetch(
      `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(
        trimmedKey
      )}/days/1/${toDate}/${fromDate}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        `Upstox Historical Error ${response.status}:`,
        errorText
      );

      return null;
    }

    const data = await response.json();

    // The documented envelope is { status: "success", data: { candles: [...] } }.
    // Anything else is a response we cannot read, which is "unavailable", not
    // "no candles".
    if (
      data?.status !== "success" ||
      !data?.data ||
      typeof data.data !== "object"
    ) {
      return null;
    }

    const candles: unknown = (data.data as Record<string, unknown>).candles;

    if (!Array.isArray(candles)) {
      return null;
    }

    // Built slot by slot, rather than passing each candle through, so the open
    // interest slot and anything else Upstox may add later cannot travel
    // further. The response body itself is not logged: unlike the news feed
    // this payload is thousands of rows.
    const rows: UpstoxCandleRow[] = [];

    for (const candle of candles) {
      if (!Array.isArray(candle) || candle.length < CANDLE_FIELD_COUNT) {
        continue;
      }

      rows.push([
        candle[0],
        candle[1],
        candle[2],
        candle[3],
        candle[4],
        candle[5],
      ]);
    }

    return rows;
  } catch (error) {
    console.error(
      `Upstox Historical Error [${trimmedKey}]:`,
      error
    );

    return null;
  }
}
