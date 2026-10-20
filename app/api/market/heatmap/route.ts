import { NextResponse } from "next/server";

import { HEATMAP_UNIVERSES, getHeatmap, isHeatmapUniverse } from "@/lib/services/heatmap";

/**
 * GET /api/market/heatmap?universe=nifty50|nifty100|…|us
 *
 * Price, day change, open, volume, sector/industry and market cap for every
 * stock in the universe, for the Heatmap page. See lib/services/heatmap.ts.
 * `capsPending` > 0 means market caps are still loading: ask again shortly.
 *
 * Failure contract, matching /api/market/nifty50: bad universe → 400,
 * unavailable → 503, unexpected throw → 500, all { success: false, error }.
 */
export async function GET(
  request: Request,
  _context?: unknown,
  load: typeof getHeatmap = getHeatmap
) {
  const universe = new URL(request.url).searchParams.get("universe") ?? "nifty50";
  if (!isHeatmapUniverse(universe)) {
    return NextResponse.json(
      { success: false, error: `universe must be one of ${HEATMAP_UNIVERSES.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const data = await load(universe);
    if (!data) {
      return NextResponse.json(
        { success: false, error: "This universe's constituent list or prices are unavailable right now" },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { success: true, ...data },
      { headers: { "Cache-Control": data.capsPending > 0 ? "no-store" : "public, s-maxage=30, stale-while-revalidate=30" } }
    );
  } catch (error) {
    console.error("Heatmap error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ success: false, error: "Failed to load the heatmap" }, { status: 500 });
  }
}
