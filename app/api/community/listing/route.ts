import { NextResponse } from "next/server";

import {
  defaultListingDeps,
  getListingStore,
  runListingTransition,
  type ListingDeps,
  type ListingStore,
} from "@/lib/community/listing";
import { isNotMigrated } from "@/lib/community/communities";

/**
 * POST /api/community/listing
 *   Authorization: Bearer <CRON_SECRET>
 *
 * For a scheduled job: links IPO communities whose issue has listed to their
 * NSE/BSE stock, by ISIN (see lib/community/listing.ts). Idempotent; failures
 * are recorded with a retry time. Without CRON_SECRET the endpoint is closed.
 */
export async function POST(
  request: Request,
  _context?: unknown,
  secret: string | undefined = process.env.CRON_SECRET,
  store: ListingStore | null = getListingStore(),
  deps: ListingDeps = defaultListingDeps
) {
  const header = request.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!store) {
    return NextResponse.json({ success: false, error: "Communities aren't set up yet.", code: "NOT_CONFIGURED" }, { status: 503 });
  }

  try {
    return NextResponse.json({ success: true, ...(await runListingTransition(store, deps)) });
  } catch (error) {
    if (isNotMigrated(error)) {
      return NextResponse.json({ success: false, error: "The communities migration hasn't been applied.", code: "NOT_CONFIGURED" }, { status: 503 });
    }
    console.error("Listing transition error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ success: false, error: "Listing check failed." }, { status: 500 });
  }
}

/** Vercel Cron calls GET, with the same Bearer CRON_SECRET header. */
export async function GET(request: Request) {
  return POST(request);
}
