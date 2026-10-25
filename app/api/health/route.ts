import { NextResponse } from "next/server";

import { getHealth } from "@/lib/services/health";

/**
 * GET /api/health
 *
 * 200 when every dependency checked is working, 503 otherwise, so an uptime
 * monitor can watch it without parsing. Today that is the Upstox token, which
 * expires daily and silently takes all Indian data with it.
 */
export async function GET(_request?: Request, _context?: unknown, load: typeof getHealth = getHealth) {
  const health = await load();
  return NextResponse.json(
    { success: health.upstox.status === "ok", ...health },
    { status: health.upstox.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
