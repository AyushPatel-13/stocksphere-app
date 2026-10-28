import { NextResponse } from "next/server";

import { cleanUpImages, getImageStore, type ImageStore } from "@/lib/community/imageService";
import { isCronAuthorized } from "@/lib/utils/cronAuth";

/**
 * POST /api/community/images/cleanup
 *   Authorization: Bearer <CRON_SECRET>
 *
 * For a scheduled job: removes Community photo uploads that no post used
 * within a day, and those left behind by deleted posts. Without CRON_SECRET
 * the endpoint is closed.
 */
export async function POST(
  request: Request,
  _context?: unknown,
  secret: string | undefined = process.env.CRON_SECRET,
  store: ImageStore | null = getImageStore()
) {
  if (!isCronAuthorized(request.headers.get("authorization") ?? "", secret)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await cleanUpImages(store);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, removed: result.removed });
  } catch (error) {
    console.error("Community image cleanup error:", error);
    return NextResponse.json({ success: false, error: "Cleanup failed." }, { status: 500 });
  }
}

/** Vercel Cron calls GET, with the same Bearer CRON_SECRET header. */
export async function GET(request: Request) {
  return POST(request);
}
