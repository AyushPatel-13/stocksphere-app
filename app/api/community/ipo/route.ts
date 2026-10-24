import { NextResponse } from "next/server";

import { getCommunityDirectory, isIpoId, type CommunityDirectory } from "@/lib/community/communities";
import { getIpoCommunityPage, lookupIpo, type IpoLookup } from "@/lib/community/ipoCommunity";

/**
 * GET /api/community/ipo?id=<Upstox IPO id>
 *
 * The IPO community header: the issue's details from Upstox (real figures
 * only) and the community record, if anyone has posted yet. Once the issue
 * lists, `community.type` is "stock" with its verified exchange, symbol and
 * stock page. Read-only. When Upstox is unavailable the community still
 * answers, with `ipoError` saying why the details are missing.
 */
export async function GET(
  request: Request,
  _context?: unknown,
  directory: CommunityDirectory | null = getCommunityDirectory(),
  lookup: (ipoId: string) => Promise<IpoLookup> = (id) => lookupIpo(id)
) {
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!isIpoId(id)) {
    return NextResponse.json({ success: false, error: "Unknown IPO." }, { status: 400 });
  }

  try {
    const page = await getIpoCommunityPage(id, directory, lookup);
    if (!page.ipo && !page.community && page.ipoError?.code === "not_found") {
      return NextResponse.json({ success: false, error: "Upstox has no IPO with that id.", code: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ success: true, ...page }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("IPO community error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ success: false, error: "Couldn't load this community." }, { status: 500 });
  }
}
