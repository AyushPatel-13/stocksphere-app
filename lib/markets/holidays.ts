/**
 * Exchange holidays and special sessions, as pure functions.
 *
 *   India  from Upstox's market-holidays list (parseUpstoxHolidays): the days
 *          NSE is closed, and the days it trades at special hours (the Diwali
 *          Muhurat evening, a Budget-day weekend session).
 *   US     from NYSE's published rules (usMarketHoliday), which are fixed
 *          enough to compute. Early closes (1 pm on the day after
 *          Thanksgiving and some Christmas Eves) aren't modelled: the market
 *          is open those days, only shorter.
 *
 * Safe in the browser.
 */

/** One day NSE doesn't keep its regular hours. */
export type ExchangeDay = {
  /** YYYY-MM-DD, in the exchange's own time zone. */
  date: string;
  description: string;
  /** No regular session that day. */
  closed: boolean;
  /** A special session's hours (epoch ms), when there is one. */
  session?: { start: number; end: number };
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * NSE's entries from Upstox's GET /v2/market/holidays: a TRADING_HOLIDAY that
 * closes NSE, or a SPECIAL_TIMING day with NSE hours. Left out: an entry
 * that doesn't touch NSE (an MCX-only holiday), one that isn't well formed,
 * and SETTLEMENT_HOLIDAY rows, which list NSE as open at its regular hours
 * (only currency settlement is off) and so aren't special for trading.
 */
export function parseUpstoxHolidays(raw: unknown): ExchangeDay[] {
  const rows = raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data) ? (raw as { data: unknown[] }).data : [];
  const days: ExchangeDay[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const { date, description, holiday_type: type, closed_exchanges: closedList, open_exchanges: openList } = row as Record<string, unknown>;
    if (typeof date !== "string" || !ISO_DAY.test(date)) continue;

    const closed = type === "TRADING_HOLIDAY" && Array.isArray(closedList) && closedList.includes("NSE");
    const open = Array.isArray(openList)
      ? (openList as Record<string, unknown>[]).find((entry) => entry && typeof entry === "object" && entry.exchange === "NSE")
      : undefined;
    const start = Number(open?.start_time);
    const end = Number(open?.end_time);
    const session = type === "SPECIAL_TIMING" && Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : undefined;
    if (!closed && !session) continue;

    days.push({
      date,
      description: typeof description === "string" && description.trim() ? description.trim().slice(0, 80) : "Exchange holiday",
      closed: closed && !session,
      ...(session ? { session } : {}),
    });
  }

  return days.sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------------ US */

const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** The `n`th (1-based) given weekday of a month; n = -1 for the last. Weekday: 0 Sunday … 6 Saturday. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  if (n > 0) {
    const first = utc(year, month, 1);
    return utc(year, month, 1 + ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7);
  }
  const last = utc(year, month + 1, 0);
  return utc(year, month, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7));
}

/** Easter Sunday (Gregorian), by the anonymous algorithm. */
function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

/**
 * A fixed-date holiday as NYSE observes it: on a Saturday it moves to the
 * Friday, on a Sunday to the Monday. New Year's Day is the exception: when
 * 1 January is a Saturday the exchange opens on Friday 31 December and
 * there's no day off.
 */
function observed(year: number, month: number, day: number, saturdayMoves = true): Date | null {
  const date = utc(year, month, day);
  const weekday = date.getUTCDay();
  if (weekday === 6) return saturdayMoves ? utc(year, month, day - 1) : null;
  if (weekday === 0) return utc(year, month, day + 1);
  return date;
}

function usHolidays(year: number): Map<string, string> {
  const days = new Map<string, string>();
  const add = (date: Date | null, name: string) => {
    if (date) days.set(iso(date), name);
  };
  add(observed(year, 1, 1, false), "New Year's Day");
  add(nthWeekday(year, 1, 1, 3), "Martin Luther King Jr. Day");
  add(nthWeekday(year, 2, 1, 3), "Washington's Birthday");
  add(new Date(easter(year).getTime() - 2 * 86_400_000), "Good Friday");
  add(nthWeekday(year, 5, 1, -1), "Memorial Day");
  if (year >= 2022) add(observed(year, 6, 19), "Juneteenth");
  add(observed(year, 7, 4), "Independence Day");
  add(nthWeekday(year, 9, 1, 1), "Labor Day");
  add(nthWeekday(year, 11, 4, 4), "Thanksgiving");
  add(observed(year, 12, 25), "Christmas Day");
  return days;
}

const usCache = new Map<number, Map<string, string>>();

/** The NYSE/Nasdaq holiday on `date` (YYYY-MM-DD, New York time), or null. */
export function usMarketHoliday(date: string): string | null {
  if (!ISO_DAY.test(date)) return null;
  const year = Number(date.slice(0, 4));
  let days = usCache.get(year);
  if (!days) {
    days = usHolidays(year);
    usCache.set(year, days);
  }
  return days.get(date) ?? null;
}
