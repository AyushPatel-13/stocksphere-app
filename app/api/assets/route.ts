import { NextResponse } from "next/server";

import { getAssetBoard, type HubType } from "@/lib/services/assetBoard";

/**
 * GET /api/assets?type=etf|crypto|bond&vs=inr|usd
 *   200 { success, type, vs, items, fetchedAt } — at least one item priced
 *   400 unknown type · 503 nothing could be priced
 */
const TYPES: HubType[] = ["etf", "crypto", "bond"];

export async function GET(
  request: Request,
  _context?: unknown,
  load: typeof getAssetBoard = getAssetBoard
) {
  const params = new URL(request.url).searchParams;
  const type = params.get("type") as HubType;
  const vs = params.get("vs")?.toUpperCase() === "USD" ? "USD" : "INR";

  if (!TYPES.includes(type)) {
    return NextResponse.json({ success: false, error: "Unknown asset type" }, { status: 400 });
  }

  try {
    const board = await load(type, vs);

    if (!board.items.some((item) => item.price !== null)) {
      return NextResponse.json({ success: false, error: "Prices are unavailable right now." }, { status: 503 });
    }

    return NextResponse.json(
      { success: true, ...board },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" } }
    );
  } catch (error) {
    console.error("Asset board error:", error);
    return NextResponse.json({ success: false, error: "Couldn't load prices." }, { status: 500 });
  }
}
