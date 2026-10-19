import { NextResponse } from "next/server";

import { getSupabaseStore, getTrending, type CommunityStore } from "@/lib/community/service";

/** GET /api/community/trending — most-discussed stocks in the last 24 hours. */
export async function GET(
  _request?: Request,
  _context?: unknown,
  store: CommunityStore | null = getSupabaseStore()
) {
  if (!store) {
    return NextResponse.json({ success: false, error: "Community isn't set up yet.", code: "NOT_CONFIGURED" }, { status: 503 });
  }

  try {
    return NextResponse.json(
      { success: true, trending: await getTrending(store) },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" } }
    );
  } catch (error) {
    console.error("Trending error:", error);
    return NextResponse.json({ success: false, error: "Couldn't load trending stocks." }, { status: 503 });
  }
}
