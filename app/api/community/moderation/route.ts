import { NextResponse } from "next/server";

import { getModerationStore, listReported, moderatePost, type ModerationStore } from "@/lib/community/moderation";

/**
 * GET  /api/community/moderation          reported posts (moderators only)
 * POST /api/community/moderation { postId, action: "hide" | "restore", reason? }
 *   Authorization: Bearer <Supabase access token>
 */

function tokenOf(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
}

export async function GET(request: Request, _context?: unknown, store: ModerationStore | null = getModerationStore()) {
  try {
    const result = await listReported(tokenOf(request), store);
    return result.ok
      ? NextResponse.json({ success: true, posts: result.value }, { headers: { "Cache-Control": "no-store" } })
      : NextResponse.json({ success: false, error: result.error, code: result.code }, { status: result.status });
  } catch (error) {
    console.error("Moderation list error:", error);
    return NextResponse.json({ success: false, error: "Couldn't load reports." }, { status: 500 });
  }
}

export async function POST(request: Request, _context?: unknown, store: ModerationStore | null = getModerationStore()) {
  let json: Record<string, unknown> | null;
  try {
    json = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
  }

  try {
    const result = await moderatePost(tokenOf(request), json ?? {}, store);
    return result.ok
      ? NextResponse.json({ success: true, ...result.value })
      : NextResponse.json({ success: false, error: result.error, code: result.code }, { status: result.status });
  } catch (error) {
    console.error("Moderation action error:", error);
    return NextResponse.json({ success: false, error: "Couldn't update the post." }, { status: 500 });
  }
}
