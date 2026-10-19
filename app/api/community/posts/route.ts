import { NextResponse } from "next/server";

import { createPost, getSupabaseStore, type CommunityStore } from "@/lib/community/service";
import { isValidSymbol } from "@/lib/validation/symbol";

/**
 * GET  /api/community/posts?symbol=TCS&sentiment=bullish&before=<iso>&limit=20
 *      GET …?parent=<post id> for a post's replies (oldest first).
 *      Public. Hidden posts never appear (RLS).
 *
 * POST /api/community/posts  { body, sentiment?, symbol?, parentId? }
 *      Authorization: Bearer <Supabase access token>
 *      201 { success, post } · 400/401/403/404/422/429/503 { success:false, error, code? }
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  _context?: unknown,
  store: CommunityStore | null = getSupabaseStore()
) {
  if (!store) {
    return NextResponse.json({ success: false, error: "Community isn't set up yet.", code: "NOT_CONFIGURED" }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;

  const symbol = params.get("symbol")?.trim().toUpperCase() || undefined;
  if (symbol && !isValidSymbol(symbol)) {
    return NextResponse.json({ success: false, error: "Invalid symbol" }, { status: 400 });
  }

  const parentId = params.get("parent") || undefined;
  if (parentId && !UUID.test(parentId)) {
    return NextResponse.json({ success: false, error: "Invalid post id" }, { status: 400 });
  }

  const sentimentParam = params.get("sentiment");
  const sentiment = sentimentParam === "bullish" || sentimentParam === "bearish" ? sentimentParam : undefined;

  const beforeParam = params.get("before");
  const before = beforeParam && !Number.isNaN(Date.parse(beforeParam)) ? new Date(beforeParam).toISOString() : undefined;

  const limit = Math.min(Math.max(Number(params.get("limit")) || 20, 1), 50);

  try {
    const posts = await store.listPosts({ symbol, parentId, sentiment, before, limit });
    return NextResponse.json({ success: true, posts, hasMore: posts.length === limit });
  } catch (error) {
    console.error("Community list error:", error);
    return NextResponse.json({ success: false, error: "Couldn't load posts." }, { status: 503 });
  }
}

export async function POST(
  request: Request,
  _context?: unknown,
  store: CommunityStore | null = getSupabaseStore()
) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;

  let json: Record<string, unknown>;
  try {
    json = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
  }

  try {
    const result = await createPost(
      {
        token,
        body: json?.body,
        sentiment: json?.sentiment,
        symbol: json?.symbol,
        parentId: json?.parentId,
      },
      store
    );

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error, code: result.code },
        { status: result.status }
      );
    }

    return NextResponse.json({ success: true, post: result.post }, { status: 201 });
  } catch (error) {
    console.error("Community post error:", error);
    return NextResponse.json({ success: false, error: "Couldn't publish your post. Please try again." }, { status: 500 });
  }
}
