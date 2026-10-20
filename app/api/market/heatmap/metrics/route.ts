import { NextResponse } from "next/server";

import { isHeatmapUniverse } from "@/lib/services/heatmap";
import { METRIC_SETS, getHeatmapMetrics, type MetricSet } from "@/lib/services/heatmapMetrics";

/**
 * GET /api/market/heatmap/metrics?universe=nifty50&set=daily|intraday|volume
 *
 * One batched set of colour metrics for a whole universe (see
 * lib/services/heatmapMetrics.ts). Failures are { success: false, error }
 * with 400 (bad or unsupported request), 503 (unavailable) or 500.
 */
export async function GET(
  request: Request,
  _context?: unknown,
  load: typeof getHeatmapMetrics = getHeatmapMetrics
) {
  const params = new URL(request.url).searchParams;
  const universe = params.get("universe") ?? "";
  const set = params.get("set") ?? "";
  if (!isHeatmapUniverse(universe) || !(METRIC_SETS as readonly string[]).includes(set)) {
    return NextResponse.json({ success: false, error: `Pass a valid universe and set (${METRIC_SETS.join(", ")}).` }, { status: 400 });
  }

  try {
    const data = await load(universe, set as MetricSet);
    if ("error" in data) return NextResponse.json({ success: false, error: data.error }, { status: data.status });
    const maxAge = set === "intraday" ? 60 : 600;
    return NextResponse.json({ success: true, ...data }, { headers: { "Cache-Control": `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}` } });
  } catch (error) {
    console.error("Heatmap metrics error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ success: false, error: "Failed to load heatmap metrics" }, { status: 500 });
  }
}
