import { NextResponse } from "next/server";

import type { PaperAssetType } from "@/lib/paper/ledger";
import { chooseReference } from "@/lib/predictions/v2/reference";
import { marketData, type PredictionMarketData } from "@/lib/predictions/v2/sources";

/**
 * GET /api/paper/quote?type=stock|etf|crypto&symbol=BTC
 *
 * The price a market order would fill at right now, by the same rule the
 * order route uses, so the ticket can show it and label it honestly.
 *
 *   200  { success, mode: "live" | "from_close", price, time, source }
 *   200  { success: false, code: "stale" | "unavailable" }  no fillable price
 *   400  unknown type or symbol
 */
const TYPES: PaperAssetType[] = ["stock", "etf", "crypto"];

export async function GET(
  request: Request,
  _context?: unknown,
  market: PredictionMarketData = marketData,
  now: () => number = Date.now
) {
  const params = new URL(request.url).searchParams;
  const type = params.get("type") as PaperAssetType;
  const symbol = params.get("symbol") ?? "";
  if (!TYPES.includes(type) || !symbol) {
    return NextResponse.json({ success: false, error: "Invalid type or symbol" }, { status: 400 });
  }

  const headers = { "Cache-Control": "no-store" };
  try {
    const at = now();
    const snapshot = await market.snapshot(type, symbol, at);
    if (!snapshot) return NextResponse.json({ success: false, error: "Unknown asset" }, { status: 400 });

    const reference = chooseReference({ assetType: type, now: at, session: snapshot.session, live: snapshot.live, lastClose: snapshot.lastClose });
    if ("error" in reference) return NextResponse.json({ success: false, code: reference.error }, { headers });
    return NextResponse.json(
      { success: true, mode: reference.mode, price: reference.price, time: reference.quoteTime, source: reference.source, currency: snapshot.currency },
      { headers }
    );
  } catch (error) {
    console.error("Paper quote error:", error);
    return NextResponse.json({ success: false, error: "Couldn't load the price." }, { status: 500 });
  }
}
