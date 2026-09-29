import { fetchHistorical } from "../providers/historical";
import { HistoricalPayload, HistoricalRange } from "../types/historical";

/**
 * The raw {values:[...]} payload, newest-first, or undefined if the provider
 * could not be read at all.
 *
 * `range` is optional. It only widens or narrows the window the provider is
 * asked for; the payload shape is identical either way, which is why
 * app/stock/[symbol]/page.tsx and components/Stock/StockChart.tsx need no
 * change. Omitting it asks for the default five-year window — see
 * lib/providers/historical.ts — which is what the stock page does.
 *
 * A provider that answered and holds no candles yields `{ values: [] }`. That
 * is NOT the same as undefined, and get_historical reports the two differently:
 * undefined is a failure, an empty payload is an honest "no candles in this
 * window".
 */
export async function getHistorical(
  symbol: string,
  range?: HistoricalRange
): Promise<HistoricalPayload | undefined> {
  const result = await fetchHistorical(symbol, range);

  return result?.data;
}
