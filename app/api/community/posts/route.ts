import { NextResponse } from "next/server";

import { isBondIsin } from "@/lib/bonds/bonds";
import { getBondResolver, type BondResolver } from "@/lib/community/bondCommunity";
import { communityScope } from "@/lib/community/communities";
import { attachContext, getContextDeps, getMentionResolver, type ContextDeps } from "@/lib/community/entities";
import { getCommunityResolver, type CommunityResolver } from "@/lib/community/ipoCommunity";
import type { MentionResolver } from "@/lib/community/mentions";
import { ASSET_FILTERS, createPost, editPost, getSupabaseStore, type AssetFilter, type CommunityStore, type ListQuery } from "@/lib/community/service";
import { isValidSymbol } from "@/lib/validation/symbol";

/**
 * GET   /api/community/posts?symbol=TCS&sentiment=bullish&before=<iso>&limit=20
 *       GET …?ipo=<Upstox IPO id> for an IPO's community.
 *       GET …?bond=<ISIN> for the posts that @mention that bond.
 *       GET …?asset=stock|ipo|bond filters the community floor by what posts are about.
 *       GET …?parent=<post id> for a post's or comment's direct replies (oldest first).
 *       GET …?thread=<post id>&after=<iso> for every comment under a top-level
 *       post, at any depth, flat and oldest first (pages of THREAD_PAGE; the
 *       next page starts at the last one's created_at, inclusive).
 *       GET …?id=<post id> for one post or comment → { success, post }.
 *       Public. Hidden posts never appear (RLS). A stock whose IPO community
 *       has been linked also shows that community's posts; an IPO community
 *       also shows posts that @mention it, and once linked, posts tagged with
 *       its ticker — the same records, never copies. Each post carries
 *       `context`: the IPO/stocks it is about, from stored relations only.
 *
 * POST  /api/community/posts  { body, sentiment?, symbol?, ipoId?, parentId?, postId?, mentions? }
 *       parentId: the post or comment answered; postId: the top-level post
 *       the reply is written under (refused when the parent isn't in it).
 * PATCH /api/community/posts  { id, body, mentions? }   (author only)
 *       Authorization: Bearer <Supabase access token>
 *       `mentions`: [{ kind: "instrument", id, type, text } | { kind: "ipo", ipoId, text } | { kind: "bond", isin, text }]
 *       — picks from the @ autocomplete; each is verified on the server.
 *       201/200 { success, post } · 400/401/403/404/422/429/503 { success:false, error, code? }
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Comments per thread page. */
const THREAD_PAGE = 200;

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const json = (await request.json()) as unknown;
    return json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  _context?: unknown,
  store: CommunityStore | null = getSupabaseStore(),
  communities: CommunityResolver | null = getCommunityResolver(),
  contextDeps: ContextDeps | null = getContextDeps(),
  bonds: BondResolver | null = getBondResolver()
) {
  if (!store) {
    return NextResponse.json({ success: false, error: "Community isn't set up yet.", code: "NOT_CONFIGURED" }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;

  const symbol = params.get("symbol")?.trim().toUpperCase() || undefined;
  if (symbol && !isValidSymbol(symbol)) {
    return NextResponse.json({ success: false, error: "Invalid symbol" }, { status: 400 });
  }

  const ipoId = params.get("ipo")?.trim() || undefined;

  const bondIsin = params.get("bond")?.trim().toUpperCase() || undefined;
  if (bondIsin && !isBondIsin(bondIsin)) {
    return NextResponse.json({ success: false, error: "Invalid bond" }, { status: 400 });
  }

  const assetParam = params.get("asset") || undefined;
  if (assetParam && assetParam !== "all" && !(ASSET_FILTERS as readonly string[]).includes(assetParam)) {
    return NextResponse.json({ success: false, error: "Invalid filter" }, { status: 400 });
  }
  const asset = assetParam && assetParam !== "all" ? (assetParam as AssetFilter) : undefined;

  const parentId = params.get("parent") || undefined;
  if (parentId && !UUID.test(parentId)) {
    return NextResponse.json({ success: false, error: "Invalid post id" }, { status: 400 });
  }

  const sentimentParam = params.get("sentiment");
  const sentiment = sentimentParam === "bullish" || sentimentParam === "bearish" ? sentimentParam : undefined;

  const beforeParam = params.get("before");
  const before = beforeParam && !Number.isNaN(Date.parse(beforeParam)) ? new Date(beforeParam).toISOString() : undefined;

  const limit = Math.min(Math.max(Number(params.get("limit")) || 20, 1), 50);

  const thread = params.get("thread") || undefined;
  const id = params.get("id") || undefined;
  if ((thread && !UUID.test(thread)) || (id && !UUID.test(id))) {
    return NextResponse.json({ success: false, error: "Invalid post id" }, { status: 400 });
  }

  try {
    if (id) {
      const [post] = await store.listPosts({ id, limit: 1 });
      if (!post) return NextResponse.json({ success: false, error: "That post no longer exists." }, { status: 404 });
      const [withContext] = post.parentId ? [post] : await attachContext([post], contextDeps);
      return NextResponse.json({ success: true, post: withContext });
    }

    if (thread) {
      // A whole thread, flat and oldest first; the client nests it by parentId.
      // Comments carry no context chips, so no lookups are made for them.
      const afterParam = params.get("after");
      const after = afterParam && !Number.isNaN(Date.parse(afterParam)) ? new Date(afterParam).toISOString() : undefined;
      const pageSize = Math.min(Math.max(Number(params.get("limit")) || THREAD_PAGE, 1), THREAD_PAGE);
      const posts = await store.listPosts({ thread, after, limit: pageSize });
      return NextResponse.json({ success: true, posts, hasMore: posts.length === pageSize });
    }

    let community: ListQuery["community"];
    if (!parentId && ipoId) {
      const found = communities ? await communities.findIpo(ipoId) : null;
      // No community yet: nobody has posted in it or mentioned it.
      if (!found) return NextResponse.json({ success: true, posts: [], hasMore: false });
      community = communityScope(found);
    } else if (!parentId && bondIsin) {
      const found = bonds ? await bonds.findBond(bondIsin) : null;
      // No community yet: nobody has mentioned this bond.
      if (!found) return NextResponse.json({ success: true, posts: [], hasMore: false });
      community = communityScope(found);
    } else if (!parentId && symbol && communities) {
      const linked = await communities.forBoard(symbol);
      if (linked) {
        const scope = communityScope(linked);
        community = { ...scope, anySymbols: Array.from(new Set([symbol, ...scope.anySymbols])) };
      }
    }

    const floor = !parentId && !symbol && !ipoId && !bondIsin;
    const posts = await store.listPosts({ symbol, community, parentId, sentiment, before, limit, ...(floor && asset ? { asset } : {}) });
    return NextResponse.json({ success: true, posts: await attachContext(posts, contextDeps), hasMore: posts.length === limit });
  } catch (error) {
    console.error("Community list error:", error);
    return NextResponse.json({ success: false, error: "Couldn't load posts." }, { status: 503 });
  }
}

export async function POST(
  request: Request,
  _context?: unknown,
  store: CommunityStore | null = getSupabaseStore(),
  communities: CommunityResolver | null = getCommunityResolver(),
  mentions: MentionResolver | null = getMentionResolver(),
  contextDeps: ContextDeps | null = getContextDeps()
) {
  const token = bearer(request);
  const json = await readJson(request);
  if (!json) return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });

  try {
    const result = await createPost(
      {
        token,
        body: json.body,
        sentiment: json.sentiment,
        symbol: json.symbol,
        parentId: json.parentId,
        postId: json.postId,
        ipoId: json.ipoId,
        mentions: json.mentions,
      },
      store,
      Date.now(),
      communities,
      mentions
    );

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error, code: result.code },
        { status: result.status }
      );
    }

    const [post] = await attachContext([result.post], contextDeps);
    return NextResponse.json({ success: true, post }, { status: 201 });
  } catch (error) {
    // Mentions picked before the post_mentions migration is applied.
    if ((error as { code?: string })?.code === "42703" || (error as { code?: string })?.code === "PGRST204") {
      return NextResponse.json({ success: false, error: "Mentions aren't switched on yet. Remove them and post again.", code: "NOT_CONFIGURED" }, { status: 503 });
    }
    console.error("Community post error:", error);
    return NextResponse.json({ success: false, error: "Couldn't publish your post. Please try again." }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  _context?: unknown,
  store: CommunityStore | null = getSupabaseStore(),
  mentions: MentionResolver | null = getMentionResolver(),
  contextDeps: ContextDeps | null = getContextDeps()
) {
  const token = bearer(request);
  const json = await readJson(request);
  if (!json) return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });

  try {
    const result = await editPost({ token, postId: json.id, body: json.body, mentions: json.mentions }, store, Date.now(), mentions);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error, code: result.code }, { status: result.status });
    }
    const [post] = await attachContext([result.post], contextDeps);
    return NextResponse.json({ success: true, post });
  } catch (error) {
    // Before the post_mentions migration the edit columns don't exist yet.
    if ((error as { code?: string })?.code === "42703" || (error as { code?: string })?.code === "PGRST204") {
      return NextResponse.json({ success: false, error: "Editing isn't switched on yet.", code: "NOT_CONFIGURED" }, { status: 503 });
    }
    console.error("Community edit error:", error);
    return NextResponse.json({ success: false, error: "Couldn't save your edit. Please try again." }, { status: 500 });
  }
}
