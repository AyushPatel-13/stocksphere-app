import { usMarketHoliday, type ExchangeDay } from "./holidays";

/**
 * Trading hours for the two markets StockSphere covers.
 *
 *   India (NSE/BSE)  Mon–Fri 09:15–15:30 Asia/Kolkata
 *   US (NYSE/Nasdaq) Mon–Fri 09:30–16:00 America/New_York
 *
 * US holidays are computed from NYSE's rules. Indian holidays and special
 * sessions (the Diwali Muhurat evening) come from the exchange calendar the
 * caller passes in (lib/services/marketCalendar.ts, from Upstox); without it
 * India falls back to the weekday timetable alone, and callers pair that
 * with the newest quote time: during scheduled hours a quote that hasn't
 * moved for a while means the exchange is probably closed, and
 * `scheduledOpenButQuiet` says so.
 */

export type Market = "IN" | "US";

export type SessionStatus = {
  market: Market;
  /** What the timetable says right now. */
  scheduled: "open" | "closed";
  /** Short label for the badge, e.g. "Open", "Closed · weekend". */
  label: string;
  /** Exchange-local time, e.g. "14:05 IST". */
  localTime: string;
  /** The holiday or special session behind today's hours, e.g. "Diwali-Balipratipada". */
  occasion?: string;
};

/** What's known beyond the weekday timetable. */
export type SessionCalendar = {
  /** NSE's holidays and special sessions; omitted or empty when the calendar couldn't be loaded. */
  india?: ExchangeDay[];
};

const MARKETS: Record<Market, { zone: string; tz: string; open: number; close: number }> = {
  IN: { zone: "Asia/Kolkata", tz: "IST", open: 9 * 60 + 15, close: 15 * 60 + 30 },
  US: { zone: "America/New_York", tz: "ET", open: 9 * 60 + 30, close: 16 * 60 },
};

function localParts(now: number, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    weekday: get("weekday"),
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

const clock = (at: number, zone: string) => {
  const { hour, minute } = localParts(at, zone);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

export function marketSession(market: Market, now: number, calendar: SessionCalendar = {}): SessionStatus {
  const { zone, tz, open, close } = MARKETS[market];
  const { weekday, date, hour, minute } = localParts(now, zone);
  const minutes = hour * 60 + minute;
  const localTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${tz}`;

  if (market === "US") {
    const holiday = usMarketHoliday(date);
    if (holiday) return { market, scheduled: "closed", label: `Closed · ${holiday}`, localTime, occasion: holiday };
  } else {
    const day = calendar.india?.find((entry) => entry.date === date);
    if (day?.session) {
      // A special session replaces the day's regular hours, weekend or not.
      const { start, end } = day.session;
      const hours = `${clock(start, zone)}–${clock(end, zone)}`;
      return now >= start && now < end
        ? { market, scheduled: "open", label: `Open · special session until ${clock(end, zone)}`, localTime, occasion: day.description }
        : { market, scheduled: "closed", label: `Closed · special session ${hours}`, localTime, occasion: day.description };
    }
    if (day?.closed) return { market, scheduled: "closed", label: `Closed · ${day.description}`, localTime, occasion: day.description };
  }

  if (weekday === "Sat" || weekday === "Sun") {
    return { market, scheduled: "closed", label: "Closed · weekend", localTime };
  }
  if (minutes < open) return { market, scheduled: "closed", label: "Pre-open", localTime };
  if (minutes >= close) return { market, scheduled: "closed", label: "Closed", localTime };
  return { market, scheduled: "open", label: "Open", localTime };
}

/**
 * True when the timetable says open but the newest quote is older than
 * `quietMs` — most likely an exchange holiday or a stalled feed.
 */
export function scheduledOpenButQuiet(
  status: SessionStatus,
  latestQuoteTime: number | null,
  now: number,
  quietMs = 30 * 60_000
): boolean {
  if (status.scheduled !== "open" || latestQuoteTime === null) return false;
  return now - latestQuoteTime > quietMs;
}
