import { NextResponse } from "next/server";

import { getScreenerFundamentals, type ScreenerFundamentals } from "@/lib/services/screenerFundamentals";

/**
 * GET /api/screener/fundamentals
 *
 * Shares outstanding, trailing EPS and NSE sector for every stock the
 * screener covers (lib/services/screenerFundamentals.ts), so it can filter
 * by market cap, P/E and sector. 503 when nothing could be loaded; the
 * screener then keeps working on prices alone.
 */
export async function GET(_request?: Request, _context?: unknown, load: () => Promise<ScreenerFundamentals | null> = getScreenerFundamentals) {
  const data = await load().catch(() => null);
  if (!data) {
    return NextResponse.json({ success: false, error: "Fundamentals are unavailable right now." }, { status: 503 });
  }
  return NextResponse.json({ success: true, source: "Yahoo Finance", ...data }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600" } });
}
