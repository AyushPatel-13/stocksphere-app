import { NextResponse } from "next/server";

import { getPaperStore, placeOrder, type PaperStore } from "@/lib/paper/service";
import { marketData, type PredictionMarketData } from "@/lib/predictions/v2/sources";

/**
 * POST /api/paper/orders { requestId, assetType, symbol, side, quantity }
 *   Authorization: Bearer <Supabase access token>
 *
 * A virtual market order, filled at the server's live price. requestId is a
 * UUID made once per order attempt; resending it returns the same trade.
 */
export async function POST(
  request: Request,
  _context?: unknown,
  store: PaperStore | null = getPaperStore(),
  market: PredictionMarketData = marketData,
  now: () => number = Date.now
) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;

  let json: Record<string, unknown> | null;
  try {
    json = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
  }

  try {
    // The token always comes from the header, never from the body.
    const result = await placeOrder({ ...json, token }, store, market, now());
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error, code: result.code }, { status: result.status });
    }
    const { ok: _ok, status, ...body } = result;
    return NextResponse.json({ success: true, ...body }, { status });
  } catch (error) {
    console.error("Paper order error:", error);
    return NextResponse.json({ success: false, error: "Couldn't place the order. Please try again." }, { status: 500 });
  }
}
