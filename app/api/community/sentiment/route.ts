import { NextResponse } from "next/server";

import { getSentiment, getSupabaseStore, type CommunityStore } from "@/lib/community/service";
import { isValidSymbol } from "@/lib/validation/symbol";

/** GET /api/community/sentiment?symbol=TCS — bullish/bearish posts in the last 7 days. */
export async function GET(
  request: Request,
  _context?: unknown,
  store: CommunityStore | null = getSupabaseStore()
) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase() ?? "";

  if (!isValidSymbol(symbol)) {
    return NextResponse.json({ success: false, error: "Invalid symbol" }, { status: 400 });
  }
  if (!store) {
    return NextResponse.json({ success: false, error: "Community isn't set up yet.", code: "NOT_CONFIGURED" }, { status: 503 });
  }

  try {
    return NextResponse.json({ success: true, ...(await getSentiment(symbol, store)) });
  } catch (error) {
    console.error("Sentiment error:", error);
    return NextResponse.json({ success: false, error: "Couldn't load sentiment." }, { status: 503 });
  }
}
