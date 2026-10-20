import { NextResponse } from "next/server";

import {
  getResolverStore,
  historyExitData,
  resolveDuePredictions,
  type ResolverData,
  type ResolverStore,
} from "@/lib/predictions/resolver";

/**
 * POST /api/predictions/resolve
 *   Authorization: Bearer <CRON_SECRET>
 *
 * For a scheduled job (e.g. every 15 minutes): scores every prediction whose
 * expiry session has finished. Without CRON_SECRET configured the endpoint is
 * closed.
 */
export async function POST(
  request: Request,
  _context?: unknown,
  secret: string | undefined = process.env.CRON_SECRET,
  store: ResolverStore | null = getResolverStore(),
  data: ResolverData = historyExitData
) {
  const header = request.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!store) {
    return NextResponse.json({ success: false, error: "Predictions aren't set up yet.", code: "NOT_CONFIGURED" }, { status: 503 });
  }

  try {
    return NextResponse.json({ success: true, ...(await resolveDuePredictions(store, data, Date.now(), 200)) });
  } catch (error) {
    console.error("Resolve error:", error);
    return NextResponse.json({ success: false, error: "Resolve failed." }, { status: 500 });
  }
}

/** Vercel Cron calls GET, with the same Bearer CRON_SECRET header. */
export async function GET(request: Request) {
  return POST(request);
}
