/**
 * Pure IPO metrics: which section an issue belongs in, its demand level,
 * money arithmetic, listing gains, and name matching for news (and for a GMP
 * provider, if one is ever configured). Every function takes real figures in
 * and returns null when an input is missing — nothing here estimates.
 */

import type { IpoBoard, PriceBand } from "./ipoParse";

/* ------------------------------------------------------------ dates and sections */

/** Today's date in India as "YYYY-MM-DD" — subscription windows are Indian dates. */
export function indiaDateKey(nowMs: number): string {
  return new Date(nowMs + 330 * 60_000).toISOString().slice(0, 10);
}

/** Days from `from` to `to` (both "YYYY-MM-DD"). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export type IpoSection = "open" | "upcoming" | "closed";

export type SectionResult = { section: IpoSection; reason: null } | { section: null; reason: string };

/**
 * The page's section for an issue, from its subscription window and today's
 * Indian date — never from a provider's status word.
 *
 *   open      openDate ≤ today ≤ closeDate (both boundary days count as open)
 *   upcoming  today < openDate
 *   closed    today > closeDate (listed issues included)
 *
 * Missing or inconsistent dates give no section, with the reason.
 */
export function ipoSection(dates: { openDate: string | null; closeDate: string | null }, today: string): SectionResult {
  const { openDate, closeDate } = dates;
  if (!openDate && !closeDate) return { section: null, reason: "Subscription dates not announced" };
  if (!openDate) return { section: null, reason: "Subscription start date not announced" };
  if (!closeDate) return { section: null, reason: "Subscription end date not announced" };
  if (closeDate < openDate) return { section: null, reason: "Subscription end date is before the start date" };
  if (today < openDate) return { section: "upcoming", reason: null };
  if (today <= closeDate) return { section: "open", reason: null };
  return { section: "closed", reason: null };
}

/* ------------------------------------------------------------ demand ("hype") */

export type DemandLevel = "not-open" | "no-data" | "undersubscribed" | "subscribed" | "strong" | "very-strong";

export type Demand = {
  level: DemandLevel;
  label: string;
  /** The figure the level was read from, in words — shown next to the label. */
  basis: string;
};

/** The bands, shown verbatim in the UI as the metric's definition. */
export const DEMAND_BANDS: { level: DemandLevel; label: string; min: number; max: number | null }[] = [
  { level: "undersubscribed", label: "Undersubscribed", min: 0, max: 1 },
  { level: "subscribed", label: "Subscribed", min: 1, max: 10 },
  { level: "strong", label: "Strong demand", min: 10, max: 50 },
  { level: "very-strong", label: "Very strong demand", min: 50, max: null },
];

export const DEMAND_DEFINITION =
  "Demand level = the overall subscription multiple (times subscribed) that Upstox reports for the issue. " +
  "Bands: under 1× Undersubscribed · 1–10× Subscribed · 10–50× Strong demand · 50× and over Very strong demand. " +
  "News count is shown beside it but is not part of the level.";

const formatTimes = (times: number) => `${times >= 100 ? times.toFixed(0) : times.toFixed(2)}×`;

/**
 * The demand level, from the overall multiple only. Before the window opens
 * there is no demand to read, whatever a provider's placeholder says.
 */
export function demandLevel(section: IpoSection, overall: number | null): Demand {
  if (section === "upcoming") return { level: "not-open", label: "Not open yet", basis: "Bidding has not started" };
  if (overall === null) return { level: "no-data", label: "No figure", basis: "Upstox has no subscription figure for this issue" };
  const band = DEMAND_BANDS.find((b) => overall >= b.min && (b.max === null || overall < b.max)) ?? DEMAND_BANDS[0];
  return { level: band.level, label: band.label, basis: `${formatTimes(overall)} overall (Upstox)` };
}

/* ------------------------------------------------------------ money arithmetic */

/** Minimum application: the minimum quantity at the upper price band. */
export function minInvestment(minimumQuantity: number | null, band: PriceBand | null): number | null {
  return minimumQuantity !== null && band ? minimumQuantity * band.high : null;
}

/** `part` as a % change on `base`; null when either is missing or base ≤ 0. */
export function changePct(value: number | null, base: number | null): number | null {
  if (value === null || base === null || base <= 0) return null;
  return ((value - base) / base) * 100;
}

/** `part` as a % of `base`; null when either is missing or base ≤ 0. */
export function percentOf(part: number | null, base: number | null): number | null {
  if (part === null || base === null || base <= 0) return null;
  return (part / base) * 100;
}

/* ------------------------------------------------------------ listing */

export type DailyCandle = { date: string; open: number | null; close: number | null };

export type ListingSession = {
  listingDayClose: number | null;
  latestClose: number | null;
  latestDate: string | null;
};

/**
 * Listing-day close and the newest close from daily candles. Null when there
 * is no candle dated on the listing date.
 */
export function listingSession(listingDate: string | null, candles: DailyCandle[]): ListingSession | null {
  if (!listingDate) return null;
  const day = candles.find((c) => c.date === listingDate);
  if (!day) return null;
  const latest = candles.filter((c) => c.date >= listingDate && c.close !== null).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  return { listingDayClose: day.close, latestClose: latest?.close ?? null, latestDate: latest?.date ?? null };
}

/* ------------------------------------------------------------ name matching */

const STOP_WORDS = new Set(["limited", "limted", "ltd", "the", "private", "pvt", "and", "co", "company", "corporation", "corp", "india", "inc", "ipo"]);

/** "Tonbo Imaging India Limited IPO" → ["tonbo", "imaging"]. */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP_WORDS.has(t));
}

/**
 * The phrase a headline must contain to count as news about an issue: the
 * first two words of its name ("reliance jio"), or the one word when the name
 * has only one (4+ letters).
 */
export function newsPhrase(name: string): string | null {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return tokens[0].length >= 4 ? tokens[0] : null;
  return `${tokens[0]} ${tokens[1]}`;
}

/** True when the headline contains the phrase as whole words. */
export function headlineMentions(headline: string, phrase: string): boolean {
  return ` ${nameTokens(headline).join(" ")} `.includes(` ${phrase} `);
}

/* ------------------------------------------------------------ GMP (optional provider) */

/** One row from a GMP provider, if one is configured. */
export type GmpRow = { name: string; board: IpoBoard; gmp: number | null; priceUpper: number | null };

function isPrefix(short: string[], long: string[]): boolean {
  return short.length > 0 && short.length <= long.length && short.every((t, i) => long[i] === t);
}

/**
 * The GMP row for an issue, or null. A row matches when it is on the same
 * board, one name's words start the other's, a one-word name has 4+ letters,
 * and — when both sides list an upper price band — the bands agree. Two or
 * more matches are ambiguous and give null.
 */
export function matchGmpRow(issue: { name: string; board: IpoBoard; priceUpper: number | null }, rows: GmpRow[]): GmpRow | null {
  const mine = nameTokens(issue.name);
  if (mine.length === 0) return null;
  const hits = rows.filter((row) => {
    if (row.board !== issue.board) return false;
    const theirs = nameTokens(row.name);
    const [short, long] = theirs.length <= mine.length ? [theirs, mine] : [mine, theirs];
    if (!isPrefix(short, long)) return false;
    if (short.length === 1 && short[0].length < 4) return false;
    if (issue.priceUpper !== null && row.priceUpper !== null && issue.priceUpper !== row.priceUpper) return false;
    return true;
  });
  return hits.length === 1 ? hits[0] : null;
}
