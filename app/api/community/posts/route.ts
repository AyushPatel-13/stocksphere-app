import { NextResponse } from "next/server";

import { isBondIsin } from "@/lib/bonds/bonds";
import { getBondResolver, type BondResolver } from "@/lib/community/bondCommunity";
import { communityScope } from "@/lib/community/communities";
import { attachContext, getContextDeps, getMentionResolver, type ContextDeps } from "@/lib/community/entities";
import { getCommunityResolver, type CommunityResolver } from "@/lib/community/ipoCommunity";
import type { MentionResolver } from "@/lib/community/mentions";
import {
  ASSET_FILTERS,
  FEEDS,
  FEED_RANGES,
  FEED_SORTS,
  PROFILE_TABS,
  createPost,
  attachQuotes,
  getFeed,
  getProfileFeed,
  type FeedName,
  type FeedRange,
  type FeedSort,
  type ProfileTab, editPost, getSupabaseStore, type AssetFilter, type CommunityStore, type ListQuery } from "@/lib/community/service";
import { isPostKind } from "@/lib/community/rules";
import type { PostView } from "@/lib/community/types";
import { isValidSymbol } from "@/lib/validation/symbol";

/**
 * GET   /api/community/posts?symbol=TCS&sentiment=bullish&before=<iso>&limit=20
 *       GET …?ipo=<Upstox IPO id> for an IPO's community.
 *       GET …?bond=<ISIN> for the posts that @mention that bond.
 *       GET …?asset=stock|ipo|bond filters the community floor by what posts are about.
 *       GET …?kind=analysis|technical|earnings|news|question|discussion filters top-level posts by type.
 *       GET …?parent=<post id> for a post's or comment's direct replies (oldest first).
 *       GET …?thread=<post id>&after=<iso> for every comment under a top-level
 *       post, at any depth, flat and oldest first (pages of THREAD_PAGE; the
 *       next page starts at the last one's created_at, inclusive).
 *       GET …?id=<post id> for one post or comment → { success, post }.
 *       GET …?feed=for-you|following|trending|latest|top&sort=hot|new|top|discussed|trending
 *         &range=day|week|month|year|all&exchange=NSE|BSE&offset=<next> for a ranked
 *         feed (community_feed migration); with symbol/ipo/bond, `sort` ranks
 *         that board. For You and Following use the bearer token's viewer
 *         (Following needs one) → { success, posts, hasMore, next, empty? }.
 *       GET …?profile=<handle>&tab=posts|replies|liked&before=<next> for a
 *       member's profile tab → { success, posts, hasMore, next }.
 *       Public. Hidden posts never appear (RLS). A stock whose IPO community
 *       has been linked also shows that community's posts; an IPO community
 *       also shows posts that @mention it, and once linked, posts tagged with
 *       its ticker — the same records, never copies. Each post carries
 *       `context`: the IPO/stocks it is about, from stored relations only.
 *
 * POST  /api/community/posts  { body, title?, kind?, sentiment?, symbol?, ipoId?, parentId?, postId?, mentions? }
 *       title (≤120 chars, one line) and kind: top-level posts only.
 *       images: [{ path, alt? }] from POST /api/community/images, at most 4, your own unused uploads.
 *       parentId: the post or comment answered; postId: the top-level post
 *       the reply is written under (refused when the parent isn't in it).
 * PATCH /api/community/posts  { id, body, mentions?, title?, kind? }   (author only; title/kind left out = unchanged)
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
  // Quote posts carry the post they quote; context (IPO, bond, prices) is added to both in one pass.
  const withExtras = async (posts: PostView[]) => attachContext(await attachQuotes(store, posts), contextDeps);

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

  const kindParam = params.get("kind") || undefined;
  if (kindParam && kindParam !== "all" && !isPostKind(kindParam)) {
    return NextResponse.json({ success: false, error: "Invalid filter" }, { status: 400 });
  }
  const kind = kindParam && isPostKind(kindParam) ? kindParam : undefined;

  const feedParam = params.get("feed") || undefined;
  const sortParam = params.get("sort") || undefined;
  const rangeParam = params.get("range") || undefined;
  const exchangeParam = params.get("exchange")?.toUpperCase() || undefined;
  if (
    (feedParam && !(FEEDS as readonly string[]).includes(feedParam)) ||
    (sortParam && !(FEED_SORTS as readonly string[]).includes(sortParam)) ||
    (rangeParam && !(FEED_RANGES as readonly string[]).includes(rangeParam)) ||
    (exchangeParam && exchangeParam !== "ALL" && exchangeParam !== "NSE" && exchangeParam !== "BSE")
  ) {
    return NextResponse.json({ success: false, error: "Invalid filter" }, { status: 400 });
  }
  const feed = feedParam as FeedName | undefined;
  const sort = sortParam as FeedSort | undefined;
  const range = rangeParam as FeedRange | undefined;
  const exchange = exchangeParam === "NSE" || exchangeParam === "BSE" ? exchangeParam : undefined;
  const offset = Math.min(Math.max(Math.floor(Number(params.get("offset")) || 0), 0), 1000);

  const beforeParam = params.get("before");
  const before = beforeParam && !Number.isNaN(Date.parse(beforeParam)) ? new Date(beforeParam).toISOString() : undefined;

  const limit = Math.min(Math.max(Number(params.get("limit")) || 20, 1), 50);

  const thread = params.get("thread") || undefined;
  const id = params.get("id") || undefined;
  if ((thread && !UUID.test(thread)) || (id && !UUID.test(id))) {
    return NextResponse.json({ success: false, error: "Invalid post id" }, { status: 400 });
  }

  const profile = params.get("profile")?.trim().toLowerCase() || undefined;
  if (profile) {
    const tabParam = params.get("tab") || "posts";
    if (!/^[a-z][a-z0-9_]{2,19}$/.test(profile) || !(PROFILE_TABS as readonly string[]).includes(tabParam)) {
      return NextResponse.json({ success: false, error: "Invalid profile" }, { status: 400 });
    }
    try {
      const result = await getProfileFeed(store, { username: profile, tab: tabParam as ProfileTab, before, limit });
      if (!result.ok) return NextResponse.json({ success: false, error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ success: true, posts: await withExtras(result.posts), hasMore: result.hasMore, next: result.next });
    } catch (error) {
      console.error("Profile feed error:", error);
      return NextResponse.json({ success: false, error: "Couldn't load posts." }, { status: 503 });
    }
  }

  // Several posts by id, in the order given (the Saved page: your bookmarks, newest first).
  const idsParam = params.get("ids");
  if (idsParam !== null) {
    const ids = [...new Set(idsParam.split(",").map((v) => v.trim()).filter(Boolean))];
    if (ids.length > 50 || ids.some((v) => !UUID.test(v))) {
      return NextResponse.json({ success: false, error: "Invalid post ids" }, { status: 400 });
    }
    try {
      const found = new Map((ids.length ? await store.listPosts({ ids, limit: ids.length }) : []).map((post) => [post.id, post]));
      return NextResponse.json({ success: true, posts: await withExtras(ids.flatMap((v) => found.get(v) ?? [])), hasMore: false });
    } catch (error) {
      console.error("Community ids error:", error);
      return NextResponse.json({ success: false, error: "Couldn't load posts." }, { status: 503 });
    }
  }

  try {
    if (id) {
      const [post] = await store.listPosts({ id, limit: 1 });
      if (!post) return NextResponse.json({ success: false, error: "That post no longer exists." }, { status: 404 });
      const [withContext] = post.parentId ? [post] : await withExtras([post]);
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

    // A ranked feed (For You, Following, Trending, Top) or a board sorted other than newest first.
    if (!parentId && ((feed && feed !== "latest") || (sort && sort !== "new"))) {
      const scope = floor ? undefined : community ? { anySymbols: community.anySymbols, anyCommunity: community.communityId } : { anySymbols: symbol ? [symbol] : [] };
      const token = bearer(request);
      const viewerId = token ? await store.verifyToken(token) : null;
      const result = await getFeed(store, {
        feed: floor ? (feed ?? "latest") : "latest",
        sort,
        range,
        viewerId,
        scope,
        sentiment,
        kind,
        exchange,
        offset,
        limit,
      });
      if (!result.ok) return NextResponse.json({ success: false, error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ success: true, posts: await withExtras(result.posts), hasMore: result.hasMore, next: result.next, ...(result.empty ? { empty: result.empty } : {}) });
    }

    const posts = await store.listPosts({ symbol, community, parentId, sentiment, kind, exchange, before, limit, ...(floor && asset ? { asset } : {}) });
    return NextResponse.json({ success: true, posts: await withExtras(posts), hasMore: posts.length === limit });
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
        title: json.title,
        kind: json.kind,
        sentiment: json.sentiment,
        symbol: json.symbol,
        parentId: json.parentId,
        postId: json.postId,
        ipoId: json.ipoId,
        mentions: json.mentions,
        quoteOf: json.quoteOf,
        images: json.images,
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

    const [post] = await attachContext(store ? await attachQuotes(store, [result.post]) : [result.post], contextDeps);
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
    const result = await editPost({ token, postId: json.id, body: json.body, mentions: json.mentions, title: json.title, kind: json.kind }, store, Date.now(), mentions);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error, code: result.code }, { status: result.status });
    }
    const [post] = await attachContext(store ? await attachQuotes(store, [result.post]) : [result.post], contextDeps);
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
