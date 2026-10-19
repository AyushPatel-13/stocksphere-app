import { NextResponse } from "next/server";

import { getMarketNewsFeed } from "@/lib/services/marketNews";
import type { NewsRegion } from "@/lib/news/types";

/**
 * GET /api/news?region=india|us
 *
 *   200  { success: true, region, items, sources, fetchedAt }  — at least one
 *        source answered; `sources` says which ones did
 *   400  unknown region
 *   503  every source failed
 *   500  unexpected error
 */
const REGIONS: NewsRegion[] = ["india", "us"];

export async function GET(
  request: Request,
  _context?: unknown,
  loadFeed: typeof getMarketNewsFeed = getMarketNewsFeed
) {
  const region = (new URL(request.url).searchParams.get("region") ?? "india").toLowerCase();

  if (!REGIONS.includes(region as NewsRegion)) {
    return NextResponse.json({ success: false, error: "Unknown region" }, { status: 400 });
  }

  try {
    const feed = await loadFeed(region as NewsRegion);

    if (!feed.sources.some((source) => source.ok)) {
      return NextResponse.json(
        { success: false, error: "News sources are unavailable right now" },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { success: true, ...feed },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=300" } }
    );
  } catch (error) {
    console.error("News API error:", error);
    return NextResponse.json({ success: false, error: "Failed to load news" }, { status: 500 });
  }
}
