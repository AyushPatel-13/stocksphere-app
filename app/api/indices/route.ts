import { NextResponse } from "next/server";

import { roundMarketPayload } from "@/lib/utils/roundPrice";
import { getLiveIndices } from "@/lib/services/indices";

/**
 * Every tracked index, Indian (Upstox) and global (Yahoo Finance).
 *
 * Failure contract, matching /api/market and /api/market/movers:
 *   - some prices        → 200, success:true, `unavailable` names any market
 *                          whose provider gave nothing
 *   - no price anywhere  → 503, success:false
 *   - unexpected throw   → 500, success:false
 * A 200 is never sent for a total outage, because the pages would render a
 * table of dashes as if that were the market.
 */
export async function GET(
  _request?: Request,
  _context?: unknown,
  loadIndices: typeof getLiveIndices = getLiveIndices
) {
  try {
    const snapshot = await loadIndices();

    if (snapshot.unavailable.length === 2) {
      return NextResponse.json(
        {
          success: false,
          data: snapshot.indices,
          unavailable: snapshot.unavailable,
          fetchedAt: snapshot.fetchedAt,
          error: "Market index data is unavailable",
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: roundMarketPayload(snapshot.indices),
        unavailable: snapshot.unavailable,
        fetchedAt: snapshot.fetchedAt,
      },
      {
        // The service already reuses a snapshot for 30s; this lets a CDN in
        // front of the app do the same.
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30",
        },
      }
    );
  } catch (error) {
    console.error("Indices API error:", error);

    return NextResponse.json(
      {
        success: false,
        data: [],
        unavailable: ["indian", "global"],
        error: "Failed to fetch market indices",
      },
      { status: 500 }
    );
  }
}
