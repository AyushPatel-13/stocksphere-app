import { NextResponse } from "next/server";

import type { AssetType } from "@/lib/data/assets";
import { getHistory, isHistoryRange, resolveAsset } from "@/lib/services/history";

/**
 * GET /api/history?type=stock|index|etf|crypto|bond&symbol=TCS&range=1d|5d|1mo|6mo|1y|5y|max&vs=inr|usd
 *
 *   200  { success, ...History }
 *   400  unknown type / range / symbol
 *   404  no history available for that asset and range
 */
const TYPES: AssetType[] = ["stock", "index", "etf", "crypto", "bond"];

export async function GET(
  request: Request,
  _context?: unknown,
  load: typeof getHistory = getHistory
) {
  const params = new URL(request.url).searchParams;
  const type = (params.get("type") ?? "stock") as AssetType;
  const range = params.get("range") ?? "1y";
  const vs = params.get("vs")?.toUpperCase() === "USD" ? "USD" : "INR";

  if (!TYPES.includes(type) || !isHistoryRange(range)) {
    return NextResponse.json({ success: false, error: "Invalid type or range" }, { status: 400 });
  }

  const asset = resolveAsset(type, params.get("symbol") ?? "", vs);
  if (!asset) {
    return NextResponse.json({ success: false, error: "Unknown asset" }, { status: 400 });
  }

  try {
    const history = await load(asset, range);

    if (!history) {
      return NextResponse.json(
        { success: false, error: "No price history is available for this range." },
        { status: 404 }
      );
    }

    const maxAge = range === "1d" || range === "5d" ? 60 : 600;
    return NextResponse.json(
      { success: true, ...history },
      { headers: { "Cache-Control": `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}` } }
    );
  } catch (error) {
    console.error("History error:", error);
    return NextResponse.json({ success: false, error: "Couldn't load price history." }, { status: 500 });
  }
}
