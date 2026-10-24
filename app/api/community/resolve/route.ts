import { NextResponse } from "next/server";

import { getCommunityResolver, publicCommunity, type CommunityResolver } from "@/lib/community/ipoCommunity";
import { isValidSymbol } from "@/lib/validation/symbol";

/**
 * GET /api/community/resolve?symbol=XYZ.NS
 *
 * The community a stock board belongs to: the IPO community that was linked
 * to this ticker by the listing service, or null for a stock without one
 * (its board works on symbols alone, as before). Public, read-only.
 */
export async function GET(
  request: Request,
  _context?: unknown,
  communities: CommunityResolver | null = getCommunityResolver()
) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  if (!isValidSymbol(symbol)) {
    return NextResponse.json({ success: false, error: "Invalid symbol" }, { status: 400 });
  }

  const community = communities ? await communities.forBoard(symbol) : null;
  return NextResponse.json(
    { success: true, community: community ? publicCommunity(community) : null },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
  );
}
