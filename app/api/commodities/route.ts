import { NextResponse } from "next/server";

import { COMMODITY_ERROR_MESSAGES, getCommodityBoard, getCommodityDetail } from "@/lib/services/commodities";

/**
 * GET /api/commodities                 every listed MCX product, near-month contract + quote
 * GET /api/commodities?symbol=GOLD     one product: every open contract with its quote
 *
 * Source: Upstox (MCX_FO). 200 { success, ... } · 404 unknown symbol / no open
 * contracts · 503 { success: false, code, error } when Upstox can't answer
 * (no token, expired token, rate limit, timeout, provider error).
 */
export async function GET(
  request: Request,
  _context?: unknown,
  loaders: { board: typeof getCommodityBoard; detail: typeof getCommodityDetail } = {
    board: getCommodityBoard,
    detail: getCommodityDetail,
  }
) {
  const symbol = new URL(request.url).searchParams.get("symbol");

  try {
    const result = symbol ? await loaders.detail(symbol) : await loaders.board();
    if (!result.ok) {
      return NextResponse.json(
        { success: false, code: result.code, error: COMMODITY_ERROR_MESSAGES[result.code] },
        { status: result.code === "not_found" ? 404 : 503 }
      );
    }
    return NextResponse.json(
      { success: true, source: "Upstox", ...result.value },
      { headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=20" } }
    );
  } catch (error) {
    console.error("Commodities error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ success: false, code: "internal", error: "Couldn't load commodity prices." }, { status: 500 });
  }
}
