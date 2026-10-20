/**
 * Heatmap metrics: what each colour option means, which data it needs, and
 * the pure calculations behind it. Every function returns null rather than a
 * number when the data doesn't support an exact answer — missing history is
 * never read as zero, and nothing intraday is estimated from daily bars.
 *
 * Dates are exchange-local: a daily bar belongs to the calendar date of the
 * listing exchange (Asia/Kolkata for NSE, America/New_York for US), which is
 * how weekends and holidays fall out naturally — they simply have no bar.
 */

export type MetricId =
  | "chg1h"
  | "chg4h"
  | "chg1d"
  | "perf1w"
  | "perf1m"
  | "perf3m"
  | "perf6m"
  | "perfytd"
  | "perf1y"
  | "premarket"
  | "postmarket"
  | "relvol"
  | "volatility"
  | "gap";

/** Which batched request supplies a metric. */
export type MetricSource = "base" | "intraday" | "daily" | "volume";
export type MetricGroup = "Short-term" | "Performance" | "Trading session" | "Activity" | "Risk";
export type Market = "India" | "US";

export type ColorScale = { kind: "diverging"; cap: number } | { kind: "sequential"; stops: readonly { at: number; color: string }[] };

export type MetricDef = {
  id: MetricId;
  group: MetricGroup;
  label: string;
  source: MetricSource;
  unit: "%" | "×";
  scale: ColorScale;
  /** Markets the data source covers. */
  markets: readonly Market[];
  /** Largest universe the metric is offered for (one request per stock). */
  maxUniverse?: number;
  definition: string;
};

export const RELVOL_MAX_UNIVERSE = 100;

export const METRICS: readonly MetricDef[] = [
  {
    id: "chg1h",
    group: "Short-term",
    label: "1h change",
    source: "intraday",
    unit: "%",
    scale: { kind: "diverging", cap: 1.5 },
    markets: ["India", "US"],
    definition:
      "Last regular-session price vs the price 60 minutes earlier in the same session, from 1-minute bars. Empty until the session has run an hour; after the close it is the session's final hour.",
  },
  {
    id: "chg4h",
    group: "Short-term",
    label: "4h change",
    source: "intraday",
    unit: "%",
    scale: { kind: "diverging", cap: 3 },
    markets: ["India", "US"],
    definition: "As 1h, over 240 minutes of the same regular session. Empty until the session has run four hours.",
  },
  {
    id: "chg1d",
    group: "Short-term",
    label: "1D change",
    source: "base",
    unit: "%",
    scale: { kind: "diverging", cap: 3 },
    markets: ["India", "US"],
    definition: "% change of the latest price vs the previous session's close (the quote provider's previous close).",
  },
  ...(
    [
      ["perf1w", "Perf 1W", 6, "7 calendar days"],
      ["perf1m", "Perf 1M", 9, "1 calendar month"],
      ["perf3m", "Perf 3M", 15, "3 calendar months"],
      ["perf6m", "Perf 6M", 21, "6 calendar months"],
      ["perfytd", "Perf YTD", 30, "the end of last calendar year"],
      ["perf1y", "Perf 1Y", 30, "1 calendar year"],
    ] as const
  ).map(
    ([id, label, cap, span]): MetricDef => ({
      id,
      group: "Performance",
      label,
      source: "daily",
      unit: "%",
      scale: { kind: "diverging", cap },
      markets: ["India", "US"],
      definition: `Total price performance from the close on the last trading day on or before ${
        id === "perfytd" ? "31 Dec of last year" : `${span} before the latest bar's date`
      } (exchange time) to the latest daily close. Split-adjusted, dividends excluded. Empty when history doesn't reach back that far.`,
    })
  ),
  {
    id: "premarket",
    group: "Trading session",
    label: "Pre-market change",
    source: "intraday",
    unit: "%",
    scale: { kind: "diverging", cap: 3 },
    markets: ["US"],
    definition: "US only: last pre-market (04:00–09:30 ET) price vs the previous regular-session close. Empty when there was no pre-market trade today.",
  },
  {
    id: "postmarket",
    group: "Trading session",
    label: "Post-market change",
    source: "intraday",
    unit: "%",
    scale: { kind: "diverging", cap: 3 },
    markets: ["US"],
    definition: "US only: last after-hours (16:00–20:00 ET) price vs that day's regular-session close. Empty until after-hours trading has happened.",
  },
  {
    id: "relvol",
    group: "Activity",
    label: "Relative volume",
    source: "volume",
    unit: "×",
    scale: {
      kind: "sequential",
      stops: [
        { at: 0.5, color: "#363a45" },
        { at: 1, color: "#414554" },
        { at: 1.5, color: "#2d5b9a" },
        { at: 2, color: "#2962ff" },
        { at: 3, color: "#7a9dff" },
      ],
    },
    markets: ["India", "US"],
    maxUniverse: RELVOL_MAX_UNIVERSE,
    definition:
      "Latest session's volume ÷ the average volume of the 20 sessions before it (daily bars). During market hours the latest session is still in progress, so the ratio grows through the day.",
  },
  {
    id: "volatility",
    group: "Risk",
    label: "Daily volatility",
    source: "daily",
    unit: "%",
    scale: {
      kind: "sequential",
      stops: [
        { at: 0.5, color: "#414554" },
        { at: 1, color: "#5e5641" },
        { at: 2, color: "#9a6d2c" },
        { at: 3, color: "#d4831f" },
        { at: 4, color: "#ff9800" },
      ],
    },
    markets: ["India", "US"],
    definition: "Standard deviation of the last 20 completed sessions' close-to-close % returns (a session still trading is left out).",
  },
  {
    id: "gap",
    group: "Risk",
    label: "Price gap",
    source: "base",
    unit: "%",
    scale: { kind: "diverging", cap: 3 },
    markets: ["India", "US"],
    definition: "Today's opening price vs the previous session's close. Empty before the open.",
  },
];

export const METRIC_BY_ID: ReadonlyMap<MetricId, MetricDef> = new Map(METRICS.map((m) => [m.id, m]));

/** Why a metric can't be used for a universe, or null when it can. */
export function metricUnavailableReason(metric: MetricDef, market: Market, universeSize: number): string | null {
  if (!metric.markets.includes(market)) return `${metric.label} isn't available for ${market === "India" ? "Indian" : "US"} stocks: our data source has no ${market === "India" ? "NSE extended-hours" : "such"} data.`;
  if (metric.maxUniverse !== undefined && universeSize > metric.maxUniverse)
    return `${metric.label} needs one history request per stock, so it's offered for universes of up to ${metric.maxUniverse} stocks.`;
  return null;
}

/* ------------------------------------------------------------ dates */

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** "YYYY-MM-DD" of an instant in a time zone. */
export function localDate(ms: number, timeZone: string): string {
  let f = dateFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dateFormatters.set(timeZone, f);
  }
  return f.format(ms);
}

/**
 * Calendar arithmetic on "YYYY-MM-DD". Months/years clamp to the month's last
 * day, so 31 Mar − 1 month is 28/29 Feb rather than rolling into March.
 */
export function shiftDate(date: string, by: { days?: number; months?: number; years?: number }): string {
  const [y, m, d] = date.split("-").map(Number);
  const totalMonths = y * 12 + (m - 1) - (by.months ?? 0) - 12 * (by.years ?? 0);
  const ny = Math.floor(totalMonths / 12);
  const nm = totalMonths - ny * 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const shifted = new Date(Date.UTC(ny, nm, Math.min(d, lastDay)) - (by.days ?? 0) * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

export type DailySeries = { times: readonly number[]; closes: readonly number[]; timeZone: string | null };
export type Perf = { value: number; fromDate: string; fromClose: number; toDate: string; toClose: number };
export type PerfPeriod = "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y";

export function perfTarget(lastDate: string, period: PerfPeriod): string {
  switch (period) {
    case "1W":
      return shiftDate(lastDate, { days: 7 });
    case "1M":
      return shiftDate(lastDate, { months: 1 });
    case "3M":
      return shiftDate(lastDate, { months: 3 });
    case "6M":
      return shiftDate(lastDate, { months: 6 });
    case "1Y":
      return shiftDate(lastDate, { years: 1 });
    case "YTD":
      return `${Number(lastDate.slice(0, 4)) - 1}-12-31`;
  }
}

/** Total price performance over a period from daily closes; null if history doesn't reach. */
export function performance(series: DailySeries, period: PerfPeriod): Perf | null {
  const { times, closes, timeZone } = series;
  if (!timeZone || times.length < 2 || times.length !== closes.length) return null;
  const last = times.length - 1;
  const toDate = localDate(times[last], timeZone);
  const target = perfTarget(toDate, period);

  let base = -1;
  for (let i = last - 1; i >= 0; i--) {
    if (localDate(times[i], timeZone) <= target) {
      base = i;
      break;
    }
  }
  if (base < 0 || !(closes[base] > 0) || !(closes[last] > 0)) return null;
  return {
    value: ((closes[last] - closes[base]) / closes[base]) * 100,
    fromDate: localDate(times[base], timeZone),
    fromClose: closes[base],
    toDate,
    toClose: closes[last],
  };
}

/**
 * Sample standard deviation of the last `sessions` close-to-close % returns
 * of completed sessions. The latest bar is dropped when `regular` (today's
 * session) contains `now` and the bar is that session's.
 */
export function dailyVolatility(series: DailySeries, now: number, regular: { start: number; end: number } | null, sessions = 20): number | null {
  const { times, timeZone } = series;
  let closes = series.closes;
  if (!timeZone || times.length !== closes.length) return null;
  if (regular && now >= regular.start && now < regular.end && times.length > 0 && localDate(times[times.length - 1], timeZone) === localDate(regular.start, timeZone)) {
    closes = closes.slice(0, -1);
  }
  if (closes.length < sessions + 1) return null;
  const tail = closes.slice(-(sessions + 1));
  const returns: number[] = [];
  for (let i = 1; i < tail.length; i++) {
    if (!(tail[i - 1] > 0)) return null;
    returns.push(((tail[i] - tail[i - 1]) / tail[i - 1]) * 100);
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance);
}

export type MinuteSeries = {
  times: readonly number[];
  closes: readonly number[];
  previousClose: number | null;
  periods: { pre: { start: number; end: number } | null; regular: { start: number; end: number } | null; post: { start: number; end: number } | null };
};

export const BAR_MS = 60_000;

function barsIn(series: MinuteSeries, p: { start: number; end: number } | null): number[] {
  if (!p) return [];
  const idx: number[] = [];
  for (let i = 0; i < series.times.length; i++) if (series.times[i] >= p.start && series.times[i] < p.end) idx.push(i);
  return idx;
}

export type Intraday = { value: number; fromTime: number; toTime: number };

/**
 * % change over the last `minutes` of the regular session, from 1-minute bars
 * (a bar's close is the price at its start + 1 minute). Null when the session
 * hasn't run that long or there's no bar at the reference time.
 */
export function intradayChange(series: MinuteSeries, minutes: number): Intraday | null {
  const regular = series.periods.regular;
  const idx = barsIn(series, regular);
  if (!regular || idx.length === 0) return null;
  const last = idx[idx.length - 1];
  const toTime = series.times[last] + BAR_MS;
  const target = toTime - minutes * 60_000;
  if (target < regular.start) return null;
  let ref = -1;
  for (let k = idx.length - 1; k >= 0; k--) {
    if (series.times[idx[k]] + BAR_MS <= target) {
      ref = idx[k];
      break;
    }
  }
  if (ref < 0) return null;
  const from = series.closes[ref];
  return { value: ((series.closes[last] - from) / from) * 100, fromTime: series.times[ref] + BAR_MS, toTime };
}

/** Pre-market: last pre bar vs previous close. Post-market: last post bar vs the session's last regular bar. */
export function extendedHoursChange(series: MinuteSeries, kind: "pre" | "post"): Intraday | null {
  const idx = barsIn(series, series.periods[kind]);
  if (idx.length === 0) return null;
  const last = idx[idx.length - 1];
  let base: number | null;
  let fromTime: number;
  if (kind === "pre") {
    base = series.previousClose;
    fromTime = series.periods.pre!.start;
  } else {
    const reg = barsIn(series, series.periods.regular);
    if (reg.length === 0) return null;
    base = series.closes[reg[reg.length - 1]];
    fromTime = series.times[reg[reg.length - 1]] + BAR_MS;
  }
  if (base === null || !(base > 0)) return null;
  return { value: ((series.closes[last] - base) / base) * 100, fromTime, toTime: series.times[last] + BAR_MS };
}

export function priceGap(open: number | null, previousClose: number | null): number | null {
  if (open === null || previousClose === null || !(open > 0) || !(previousClose > 0)) return null;
  return ((open - previousClose) / previousClose) * 100;
}

export type VolumeBar = { t: number; v: number | null };

/** Latest bar's volume ÷ mean of the `lookback` bars before it; null without a full lookback. */
export function relativeVolume(bars: readonly VolumeBar[], lookback = 20): { value: number; at: number } | null {
  if (bars.length < lookback + 1) return null;
  const last = bars[bars.length - 1];
  if (last.v === null || last.v < 0) return null;
  const prior = bars.slice(-(lookback + 1), -1);
  if (prior.some((b) => b.v === null || b.v < 0)) return null;
  const mean = prior.reduce((s, b) => s + (b.v as number), 0) / lookback;
  if (!(mean > 0)) return null;
  return { value: last.v / mean, at: last.t };
}
