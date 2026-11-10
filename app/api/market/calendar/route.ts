import { NextResponse } from "next/server";

import { getMarketCalendar, type MarketCalendar } from "@/lib/services/marketCalendar";

/**
 * GET /api/market/calendar
 *
 * NSE's holidays and special sessions for the year, from Upstox, for the
 * open/closed badges. 503 when the list can't be loaded (never an empty
 * list, which would read as "no holidays"); the pages then fall back to the
 * weekday timetable. US holidays are computed in the browser from NYSE's rules.
 */
export async function GET(_request?: Request, _context?: unknown, load: () => Promise<MarketCalendar | null> = getMarketCalendar) {
  const calendar = await load().catch(() => null);
  if (!calendar) {
    return NextResponse.json({ success: false, error: "The exchange calendar is unavailable right now." }, { status: 503 });
  }
  return NextResponse.json(
    { success: true, ...calendar },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=43200" } }
  );
}
