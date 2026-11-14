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
  /** Market cap ÷ the last fiscal year's net income. A loss-making company has no P/E and fails either bound. */
  minPe: number | null;
  maxPe: number | null;
  /** Market cap floors, each in its own market's usual unit; a floor only applies to rows in that currency. */
  minMarketCapCr: number | null;
  minMarketCapUsdBn: number | null;
  /** NSE sector, exactly as NSE names it. US stocks have no sector here and never match one. */
  sector: string | null;
};

/** What the screener knows about a company beyond its price. Any of it may be missing. */
export type RowFundamentals = { sector?: string | null; marketCap?: number | null; pe?: number | null };

/**
 * Market cap and P/E for one row, from the price shown beside them. Market
 * cap is price × shares outstanding; P/E is that ÷ the last fiscal year's
 * net income, which (unlike a per-share figure) a split or bonus issue can't
 * distort. No profit, no P/E.
 */
export function deriveFundamentals(
  price: number | null,
  f: { sector: string | null; sharesOutstanding: number | null; netIncomeFy: number | null } | undefined
): Required<RowFundamentals> {
  const priced = typeof price === "number" && price > 0 ? price : null;
  const marketCap = priced !== null && f?.sharesOutstanding ? Math.round(priced * f.sharesOutstanding) : null;
  return {
    sector: f?.sector ?? null,
    marketCap,
    pe: marketCap !== null && f?.netIncomeFy && f.netIncomeFy > 0 ? marketCap / f.netIncomeFy : null,
  };
}

export type ScreenInput = WatchlistRow & { market: "india" | "us" } & RowFundamentals;

export const EMPTY_CRITERIA: ScreenCriteria = {
  market: "all",
  minChangePct: null,
  maxChangePct: null,
  withinOfHighPct: null,
  withinOfLowPct: null,
  minVolume: null,
  minPe: null,
  maxPe: null,
  minMarketCapCr: null,
  minMarketCapUsdBn: null,
  sector: null,
};

/** A saved or shared screen, made whole: unknown keys dropped, missing ones (a screen saved before a filter existed) empty. */
export function normaliseCriteria(raw: unknown): ScreenCriteria {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const number = (key: keyof ScreenCriteria) => (typeof input[key] === "number" && Number.isFinite(input[key] as number) ? (input[key] as number) : null);
  return {
    market: input.market === "india" || input.market === "us" ? input.market : "all",
    minChangePct: number("minChangePct"),
    maxChangePct: number("maxChangePct"),
    withinOfHighPct: number("withinOfHighPct"),
    withinOfLowPct: number("withinOfLowPct"),
    minVolume: number("minVolume"),
    minPe: number("minPe"),
    maxPe: number("maxPe"),
    minMarketCapCr: number("minMarketCapCr"),
    minMarketCapUsdBn: number("minMarketCapUsdBn"),
    sector: typeof input.sector === "string" && input.sector.trim() ? input.sector.trim().slice(0, 80) : null,
  };
}

export type PresetId = "all" | "gainers" | "losers" | "near_high" | "near_low" | "big_movers" | "low_pe";

export const PRESETS: { id: PresetId; label: string; criteria: Partial<ScreenCriteria>; sort: { key: ScreenSortKey; desc: boolean } }[] = [
  { id: "all", label: "All", criteria: {}, sort: { key: "change", desc: true } },
  { id: "gainers", label: "Gainers", criteria: { minChangePct: 0.01 }, sort: { key: "change", desc: true } },
  { id: "losers", label: "Losers", criteria: { maxChangePct: -0.01 }, sort: { key: "change", desc: false } },
  { id: "near_high", label: "Near 52W high", criteria: { withinOfHighPct: 5 }, sort: { key: "position", desc: true } },
  { id: "near_low", label: "Near 52W low", criteria: { withinOfLowPct: 5 }, sort: { key: "position", desc: false } },
  { id: "big_movers", label: "Moves over 3%", criteria: {}, sort: { key: "change", desc: true } },
  { id: "low_pe", label: "P/E under 15", criteria: { maxPe: 15 }, sort: { key: "pe", desc: false } },
];

export type ScreenSortKey = "symbol" | "price" | "change" | "volume" | "position" | "marketCap" | "pe";

export type ScreenRow = ScreenInput & { position52w: number | null; reasons: string[] };

/** "₹17.92 L Cr" / "₹80,775 Cr" / "$3.52T" / "$36.30B", for a reason line or a table cell. */
export function formatCap(value: number, currency: "INR" | "USD"): string {
  if (currency === "INR") {
    const crore = value / 1e7;
    return crore >= 1e5 ? `₹${(crore / 1e5).toFixed(2)} L Cr` : `₹${crore.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
  }
  return value >= 1e12 ? `$${(value / 1e12).toFixed(2)}T` : `$${(value / 1e9).toFixed(2)}B`;
}

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
export function applyScreen(rows: ScreenInput[], criteria: ScreenCriteria, bigMovers = false): ScreenRow[] {
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

    const pe = typeof row.pe === "number" && Number.isFinite(row.pe) && row.pe > 0 ? row.pe : null;
    if (criteria.minPe !== null) {
      if (pe === null || pe < criteria.minPe) continue;
      reasons.push(`P/E ${pe.toFixed(1)} ≥ ${criteria.minPe}`);
    }
    if (criteria.maxPe !== null) {
      if (pe === null || pe > criteria.maxPe) continue;
      reasons.push(`P/E ${pe.toFixed(1)} ≤ ${criteria.maxPe}`);
    }
    // A market-cap floor is in one market's unit, so it judges only that market's rows;
    // the other market's rows aren't filtered by it (and are by their own floor, if set).
    const cap = typeof row.marketCap === "number" && row.marketCap > 0 ? row.marketCap : null;
    const floor = row.market === "india" ? criteria.minMarketCapCr : criteria.minMarketCapUsdBn;
    if (floor !== null) {
      const unit = row.market === "india" ? 1e7 : 1e9;
      if (cap === null || cap < floor * unit) continue;
      reasons.push(`market cap ${formatCap(cap, row.market === "india" ? "INR" : "USD")} ≥ ${row.market === "india" ? `₹${floor.toLocaleString("en-IN")} Cr` : `$${floor}B`}`);
    }
    if (criteria.sector !== null) {
      if (row.sector !== criteria.sector) continue;
      reasons.push(`sector: ${row.sector}`);
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
    // A missing figure sorts last whichever way the column is ordered.
    if (key === "marketCap") return row.marketCap ?? (desc ? -Infinity : Infinity);
    if (key === "pe") return row.pe && row.pe > 0 ? row.pe : desc ? -Infinity : Infinity;
    return row.position52w ?? -Infinity;
  };
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const order = typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : (x as number) - (y as number);
    return desc ? -order : order;
  });
}
