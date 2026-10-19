import { ALL_INDICES, type MarketIndex } from "../data/instruments/indices";
import { getHistory, resolveAsset, type History } from "./history";

/**
 * Every tracked index with a small intraday sparkline and its 52-week range,
 * for the "All indices" table on index pages. Built from the same 1-minute
 * history the charts use (cached there), so it adds no new provider.
 */

export type IndexOverviewRow = {
  symbol: string;
  name: string;
  category: MarketIndex["category"];
  price: number | null;
  change: number | null;
  changePercent: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  /** Up to SPARK_POINTS closes, oldest first. */
  spark: number[];
};

export const SPARK_POINTS = 48;

/** Evenly thin a series to at most `max` points, always keeping the last. */
export function downsample(values: number[], max: number = SPARK_POINTS): number[] {
  if (values.length <= max) return values;
  const step = (values.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => values[Math.round(i * step)]);
}

export function toOverviewRow(index: MarketIndex, history: History | null): IndexOverviewRow {
  const closes = history?.candles.map((candle) => candle.c) ?? [];
  const price = closes.at(-1) ?? null;
  const previous = history?.previousClose ?? null;
  const change = price !== null && previous !== null ? price - previous : null;

  return {
    symbol: index.symbol,
    name: index.name,
    category: index.category,
    price,
    change,
    changePercent: change !== null && previous ? (change / previous) * 100 : null,
    fiftyTwoWeekHigh: history?.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: history?.fiftyTwoWeekLow ?? null,
    spark: downsample(closes),
  };
}

export async function getIndexOverview(
  load: typeof getHistory = getHistory
): Promise<IndexOverviewRow[]> {
  return Promise.all(
    ALL_INDICES.map(async (index) => {
      const asset = resolveAsset("index", index.symbol);
      const history = asset ? await load(asset, "1d").catch(() => null) : null;
      return toOverviewRow(index, history);
    })
  );
}
