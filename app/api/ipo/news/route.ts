import { NextResponse } from "next/server";

import { getIpoNews } from "@/lib/services/ipo";

/**
 * GET /api/ipo/news
 *
 * IPO headlines plus, for each issue on /api/ipo, the headlines that mention
 * it and a 7-day count. Kept apart from /api/ipo so slow feeds never hold up
 * the calendar. Unavailable → 503, unexpected throw → 500.
 */
export async function GET(_request?: Request, _context?: unknown, load: typeof getIpoNews = getIpoNews) {
  try {
    const data = await load();
    if (!data) {
      return NextResponse.json({ success: false, error: "IPO news feeds are unavailable right now" }, { status: 503 });
    }
    return NextResponse.json(
      { success: true, ...data },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
    );
  } catch (error) {
    console.error("IPO news error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ success: false, error: "Failed to load IPO news" }, { status: 500 });
  }
}
