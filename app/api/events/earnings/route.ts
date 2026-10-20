import { NextResponse } from "next/server";

import { getEarningsCalendar } from "@/lib/services/earningsCalendar";

/**
 * GET /api/events/earnings?days=14 — US earnings dates from today, via
 * Finnhub. days is 1–30. 503 when the provider isn't available.
 */
export async function GET(request: Request, _context?: unknown, load: typeof getEarningsCalendar = getEarningsCalendar, now: () => number = Date.now) {
  const daysParam = Number(new URL(request.url).searchParams.get("days") ?? 14);
  const days = Number.isInteger(daysParam) && daysParam >= 1 && daysParam <= 30 ? daysParam : null;
  if (days === null) {
    return NextResponse.json({ success: false, error: "days must be a whole number from 1 to 30." }, { status: 400 });
  }

  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const from = iso(now());
  const to = iso(now() + days * 86_400_000);

  const events = await load(from, to);
  if (!events) {
    return NextResponse.json({ success: false, error: "The earnings calendar is unavailable right now." }, { status: 503 });
  }
  return NextResponse.json(
    { success: true, from, to, source: "Finnhub", events },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=3600" } }
  );
}
