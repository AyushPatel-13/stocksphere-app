import { NextResponse } from "next/server";

import { getIndexOverview } from "@/lib/services/indexOverview";

/**
 * GET /api/indices/overview — every index with value, day change, 52-week
 * range and an intraday sparkline. 503 when nothing could be priced.
 */
export async function GET(
  _request?: Request,
  _context?: unknown,
  load: typeof getIndexOverview = getIndexOverview
) {
  try {
    const rows = await load();
    if (!rows.some((row) => row.price !== null)) {
      return NextResponse.json({ success: false, error: "Index data is unavailable right now." }, { status: 503 });
    }
    return NextResponse.json(
      { success: true, indices: rows },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" } }
    );
  } catch (error) {
    console.error("Index overview error:", error);
    return NextResponse.json({ success: false, error: "Couldn't load indices." }, { status: 500 });
  }
}
