import { NextResponse } from "next/server";

import { getIpoBoard } from "@/lib/services/ipo";

/**
 * GET /api/ipo
 *
 * Every Indian IPO the IPO page shows — open, upcoming, and closed in the last
 * 30 days — from Upstox's official IPO API, in one batched, cached response.
 * Sections come from subscription dates in Indian time; issues without dates
 * are in `unclassified` with the reason. See lib/services/ipo.ts.
 *
 * Failure contract: Upstox unavailable (no token, expired token, rate limit,
 * timeout, provider error) → 503 { success: false, code, error } with a
 * readable message; unexpected throw → 500. The token never reaches the client.
 */
export async function GET(_request?: Request, _context?: unknown, load: typeof getIpoBoard = getIpoBoard) {
  try {
    const result = await load();
    if (!result.ok) {
      return NextResponse.json({ success: false, code: result.code, error: result.message }, { status: 503 });
    }
    return NextResponse.json(
      { success: true, ...result.data },
      { headers: { "Cache-Control": result.data.staleReason ? "no-store" : "public, s-maxage=60, stale-while-revalidate=120" } }
    );
  } catch (error) {
    console.error("IPO board error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ success: false, code: "internal", error: "Failed to load IPOs" }, { status: 500 });
  }
}
