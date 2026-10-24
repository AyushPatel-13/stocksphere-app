/**
 * Regular trading hours for the two markets StockSphere covers, from the
 * clock alone.
 *
 *   India (NSE/BSE)  Mon–Fri 09:15–15:30 Asia/Kolkata
 *   US (NYSE/Nasdaq) Mon–Fri 09:30–16:00 America/New_York
 *
 * Exchange holidays aren't known here, so this is the *schedule*, not proof
 * the market is trading. Callers pair it with the newest quote time: during
 * scheduled hours a quote that hasn't moved for a while means the exchange is
 * probably closed for a holiday, and `scheduledOpenButQuiet` says so.
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
};

const MARKETS: Record<Market, { zone: string; tz: string; open: number; close: number }> = {
  IN: { zone: "Asia/Kolkata", tz: "IST", open: 9 * 60 + 15, close: 15 * 60 + 30 },
  US: { zone: "America/New_York", tz: "ET", open: 9 * 60 + 30, close: 16 * 60 },
};

function localParts(now: number, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: get("weekday"), hour: Number(get("hour")), minute: Number(get("minute")) };
}

export function marketSession(market: Market, now: number): SessionStatus {
  const { zone, tz, open, close } = MARKETS[market];
  const { weekday, hour, minute } = localParts(now, zone);
  const minutes = hour * 60 + minute;
  const localTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${tz}`;

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
