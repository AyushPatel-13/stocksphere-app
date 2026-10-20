import type { WatchlistRow } from "../services/watchlistRows";

/**
 * Stock screener rules. Pure and transparent: every result carries the
 * reasons it matched, built from the same numbers shown in the table.
 * Data is end-of-minute price data (may be delayed) — screens describe what
 * happened, they don't predict anything.
 */

export const US_LARGE_CAPS = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "JPM", "V",
  "MA", "UNH", "XOM", "JNJ", "WMT", "PG", "HD", "COST", "NFLX", "AMD",
];

export type ScreenCriteria = {
  market: "all" | "india" | "us";
  minChangePct: number | null;
  maxChangePct: number | null;
  /** Price within this % below the 52-week high. */
  withinOfHighPct: number | null;
  /** Price within this % above the 52-week low. */
  withinOfLowPct: number | null;
  minVolume: number | null;
};

export const EMPTY_CRITERIA: ScreenCriteria = {
  market: "all",
  minChangePct: null,
  maxChangePct: null,
  withinOfHighPct: null,
  withinOfLowPct: null,
  minVolume: null,
};

export type PresetId = "all" | "gainers" | "losers" | "near_high" | "near_low" | "big_movers";

export const PRESETS: { id: PresetId; label: string; criteria: Partial<ScreenCriteria>; sort: { key: ScreenSortKey; desc: boolean } }[] = [
  { id: "all", label: "All", criteria: {}, sort: { key: "change", desc: true } },
  { id: "gainers", label: "Gainers", criteria: { minChangePct: 0.01 }, sort: { key: "change", desc: true } },
  { id: "losers", label: "Losers", criteria: { maxChangePct: -0.01 }, sort: { key: "change", desc: false } },
  { id: "near_high", label: "Near 52W high", criteria: { withinOfHighPct: 5 }, sort: { key: "position", desc: true } },
  { id: "near_low", label: "Near 52W low", criteria: { withinOfLowPct: 5 }, sort: { key: "position", desc: false } },
  { id: "big_movers", label: "Moves over 3%", criteria: {}, sort: { key: "change", desc: true } },
];

export type ScreenSortKey = "symbol" | "price" | "change" | "volume" | "position";

export type ScreenRow = WatchlistRow & { market: "india" | "us"; position52w: number | null; reasons: string[] };

export function position52w(row: WatchlistRow): number | null {
  const { price, fiftyTwoWeekLow: low, fiftyTwoWeekHigh: high } = row;
  return price !== null && low !== null && high !== null && high > low
    ? Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100))
    : null;
}

const pct = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

/**
 * Apply criteria. A row with a missing value fails any criterion that needs
 * that value — it is never assumed to pass.
 */
export function applyScreen(rows: (WatchlistRow & { market: "india" | "us" })[], criteria: ScreenCriteria, bigMovers = false): ScreenRow[] {
  const out: ScreenRow[] = [];

  for (const row of rows) {
    if (row.price === null) continue;
    if (criteria.market !== "all" && row.market !== criteria.market) continue;

    const reasons: string[] = [];
    const change = row.changePercent;

    if (bigMovers) {
      if (change === null || Math.abs(change) < 3) continue;
      reasons.push(`moved ${pct(change)} today`);
    }
    if (criteria.minChangePct !== null) {
      if (change === null || change < criteria.minChangePct) continue;
      reasons.push(`day change ${pct(change)} ≥ ${criteria.minChangePct}%`);
    }
    if (criteria.maxChangePct !== null) {
      if (change === null || change > criteria.maxChangePct) continue;
      reasons.push(`day change ${pct(change)} ≤ ${criteria.maxChangePct}%`);
    }
    if (criteria.withinOfHighPct !== null) {
      const high = row.fiftyTwoWeekHigh;
      if (high === null || high <= 0) continue;
      const below = ((high - row.price) / high) * 100;
      if (below > criteria.withinOfHighPct) continue;
      reasons.push(`${below.toFixed(2)}% below its 52-week high`);
    }
    if (criteria.withinOfLowPct !== null) {
      const low = row.fiftyTwoWeekLow;
      if (low === null || low <= 0) continue;
      const above = ((row.price - low) / low) * 100;
      if (above > criteria.withinOfLowPct) continue;
      reasons.push(`${above.toFixed(2)}% above its 52-week low`);
    }
    if (criteria.minVolume !== null) {
      if (row.volume === null || row.volume < criteria.minVolume) continue;
      reasons.push(`volume ${row.volume.toLocaleString("en-IN")} ≥ ${criteria.minVolume.toLocaleString("en-IN")}`);
    }

    out.push({ ...row, position52w: position52w(row), reasons });
  }

  return out;
}

export function sortScreen(rows: ScreenRow[], key: ScreenSortKey, desc: boolean): ScreenRow[] {
  const value = (row: ScreenRow): number | string => {
    if (key === "symbol") return row.symbol;
    if (key === "price") return row.price ?? -Infinity;
    if (key === "change") return row.changePercent ?? -Infinity;
    if (key === "volume") return row.volume ?? -Infinity;
    return row.position52w ?? -Infinity;
  };
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const order = typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : (x as number) - (y as number);
    return desc ? -order : order;
  });
}
