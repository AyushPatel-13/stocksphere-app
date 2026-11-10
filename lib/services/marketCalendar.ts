import { upstoxFetch } from "../apis/upstoxGate";
import { parseUpstoxHolidays, type ExchangeDay } from "../markets/holidays";

/**
 * NSE's holidays and special sessions for the current year, from Upstox's
 * market-holidays list (the exchange's own calendar, including the Diwali
 * Muhurat session and one-off closures such as election days).
 *
 * The list changes a few times a year at most, so it is kept for 12 hours.
 * When Upstox can't be reached the last good list is served; with none, the
 * answer is null and callers fall back to the weekday timetable. An empty
 * list is never invented.
 */

export type MarketCalendar = { india: ExchangeDay[]; source: "Upstox"; fetchedAt: string };

const TTL_MS = 12 * 3_600_000;
const RETRY_MS = 5 * 60_000;

async function fetchUpstoxHolidays(): Promise<unknown | null> {
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) return null;
  const response = await upstoxFetch("https://api.upstox.com/v2/market/holidays", {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return response.ok ? response.json() : null;
}

export function createCalendarLoader(load: () => Promise<unknown | null> = fetchUpstoxHolidays, now: () => number = Date.now) {
  let good: { at: number; calendar: MarketCalendar } | null = null;
  let failedAt = 0;

  return async function getMarketCalendar(): Promise<MarketCalendar | null> {
    if (good && now() - good.at < TTL_MS) return good.calendar;
    // After a failure, don't ask again on every request.
    if (failedAt && now() - failedAt < RETRY_MS) return good?.calendar ?? null;

    const raw = await load().catch(() => null);
    const india = raw === null ? [] : parseUpstoxHolidays(raw);
    // A year always has holidays: an empty parse means the answer wasn't the list.
    if (india.length === 0) {
      failedAt = now();
      return good?.calendar ?? null;
    }
    failedAt = 0;
    good = { at: now(), calendar: { india, source: "Upstox", fetchedAt: new Date(now()).toISOString() } };
    return good.calendar;
  };
}

export const getMarketCalendar = createCalendarLoader();
