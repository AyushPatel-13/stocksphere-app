import { NextResponse } from "next/server";

import { communityScope } from "@/lib/community/communities";
import { getCommunityResolver, type CommunityResolver } from "@/lib/community/ipoCommunity";
import { getSentiment, getSupabaseStore, SENTIMENT_WINDOW_DAYS, type CommunityStore } from "@/lib/community/service";
import { isValidSymbol } from "@/lib/validation/symbol";

/**
 * GET /api/community/sentiment?symbol=TCS — bullish/bearish posts in the last 7 days.
 * GET /api/community/sentiment?ipo=<Upstox IPO id> — the same for an IPO's community.
 * Counted over the same posts the board lists (see /api/community/posts).
 */
export async function GET(
  request: Request,
  _context?: unknown,
  store: CommunityStore | null = getSupabaseStore(),
  communities: CommunityResolver | null = getCommunityResolver()
) {
  const params = new URL(request.url).searchParams;
  const ipoId = params.get("ipo")?.trim() ?? "";
  const symbol = params.get("symbol")?.trim().toUpperCase() ?? "";

  if (!ipoId && !isValidSymbol(symbol)) {
    return NextResponse.json({ success: false, error: "Invalid symbol" }, { status: 400 });
  }
  if (!store) {
    return NextResponse.json({ success: false, error: "Community isn't set up yet.", code: "NOT_CONFIGURED" }, { status: 503 });
  }

  try {
    if (ipoId) {
      const found = communities ? await communities.findIpo(ipoId) : null;
      if (!found) {
        return NextResponse.json({ success: true, symbol: "", bullish: 0, bearish: 0, total: 0, windowDays: SENTIMENT_WINDOW_DAYS });
      }
      return NextResponse.json({ success: true, ...(await getSentiment(found.symbol ?? "", store, Date.now(), communityScope(found))) });
    }

    const linked = communities ? await communities.forBoard(symbol) : null;
    const scope = linked ? communityScope(linked) : undefined;
    return NextResponse.json({
      success: true,
      ...(await getSentiment(symbol, store, Date.now(), scope && { ...scope, anySymbols: Array.from(new Set([symbol, ...scope.anySymbols])) })),
    });
  } catch (error) {
    console.error("Sentiment error:", error);
    return NextResponse.json({ success: false, error: "Couldn't load sentiment." }, { status: 503 });
  }
}
