import { getAdminClient, getPublicClient } from "../supabase/server";
import { isValidSymbol } from "../validation/symbol";
import { stockBoardSymbol } from "./communities";
import type { CommunityResolver } from "./ipoCommunity";
import {
  LINK_UNLOCK_DAYS,
  accountAgeDays,
  checkContent,
  checkRate,
  normaliseForDuplicate,
  postSymbols,
  type Sentiment,
} from "./rules";
import type { PostView, SentimentSummary, TrendingSymbol } from "./types";

/**
 * Community posts: the only place posts are created, so the only place the
 * rules are enforced. Reads use the public (anon) client so RLS decides what
 * is visible; writes use the service role after every check has passed.
 *
 * The store is injected so the whole flow is testable without Supabase.
 */

export type AuthorRecord = { id: string; createdAt: string };

export type NewPostRow = {
  author_id: string;
  body: string;
  sentiment: Sentiment | null;
  symbols: string[];
  parent_id: string | null;
  /** Only set when the post belongs to a community (communities migration). */
  community_id?: string;
};

/** A community's feed: its own posts, plus (once listed) posts tagged with its ticker. */
export type CommunityScope = { communityId: string; anySymbols: string[] };

export type ListQuery = {
  symbol?: string;
  /** Overrides `symbol` when set. */
  community?: CommunityScope;
  parentId?: string;
  sentiment?: Sentiment;
  before?: string;
  limit: number;
};

export interface CommunityStore {
  /** The user a Supabase access token belongs to, or null if invalid. */
  verifyToken(token: string): Promise<string | null>;
  getAuthor(userId: string): Promise<AuthorRecord | null>;
  countPostsSince(authorId: string, sinceIso: string): Promise<number>;
  recentBodies(authorId: string, sinceIso: string): Promise<string[]>;
  /** A visible top-level post's symbols, or null when it doesn't exist. */
  getParent(postId: string): Promise<{ symbols: string[] } | null>;
  insertPost(row: NewPostRow): Promise<PostView>;
  listPosts(query: ListQuery): Promise<PostView[]>;
  sentiment(scope: string | CommunityScope, sinceIso: string): Promise<Omit<SentimentSummary, "symbol" | "windowDays">>;
  recentSymbols(sinceIso: string, limit: number): Promise<string[][]>;
}

export type CreatePostInput = {
  token: string | null;
  body: unknown;
  sentiment?: unknown;
  symbol?: unknown;
  parentId?: unknown;
  /** An Upstox IPO id: post in that IPO's community. */
  ipoId?: unknown;
};

export type CreatePostResult =
  | { ok: true; post: PostView }
  | { ok: false; status: number; error: string; code?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createPost(
  input: CreatePostInput,
  store: CommunityStore | null,
  now: number = Date.now(),
  communities: CommunityResolver | null = null
): Promise<CreatePostResult> {
  if (!store) {
    return { ok: false, status: 503, error: "Posting isn't set up yet.", code: "NOT_CONFIGURED" };
  }

  if (!input.token) {
    return { ok: false, status: 401, error: "Sign in to post.", code: "SIGNED_OUT" };
  }

  const userId = await store.verifyToken(input.token);
  if (!userId) {
    return { ok: false, status: 401, error: "Your session expired. Please sign in again.", code: "SIGNED_OUT" };
  }

  const author = await store.getAuthor(userId);
  if (!author) {
    return { ok: false, status: 403, error: "Pick your @handle before posting.", code: "NO_PROFILE" };
  }

  if (typeof input.body !== "string") {
    return { ok: false, status: 400, error: "Write something first." };
  }

  const sentiment =
    input.sentiment === "bullish" || input.sentiment === "bearish" ? input.sentiment : null;

  const board =
    typeof input.symbol === "string" && input.symbol.trim() ? input.symbol.trim().toUpperCase() : null;
  if (board && !isValidSymbol(board)) {
    return { ok: false, status: 400, error: "Unknown stock." };
  }

  const ipoId = typeof input.ipoId === "string" && input.ipoId.trim() ? input.ipoId.trim() : null;
  if (input.ipoId !== undefined && input.ipoId !== null && !ipoId) {
    return { ok: false, status: 400, error: "Unknown IPO." };
  }

  let parentId: string | null = null;
  let parentSymbols: string[] = [];

  if (input.parentId !== undefined && input.parentId !== null) {
    if (typeof input.parentId !== "string" || !UUID.test(input.parentId)) {
      return { ok: false, status: 400, error: "Invalid reply." };
    }
    const parent = await store.getParent(input.parentId);
    if (!parent) return { ok: false, status: 404, error: "That post no longer exists." };
    parentId = input.parentId;
    parentSymbols = parent.symbols;
  }

  const age = accountAgeDays(author.createdAt, now);

  const content = checkContent(input.body, age >= LINK_UNLOCK_DAYS);
  if (!content.ok) return { ok: false, status: 422, error: content.reason, code: "RULES" };

  const [last10Minutes, last24Hours] = await Promise.all([
    store.countPostsSince(author.id, new Date(now - 10 * 60_000).toISOString()),
    store.countPostsSince(author.id, new Date(now - 86_400_000).toISOString()),
  ]);

  const rate = checkRate({ last10Minutes, last24Hours }, age);
  if (!rate.ok) return { ok: false, status: 429, error: rate.reason, code: "RATE_LIMITED" };

  const fingerprint = normaliseForDuplicate(content.body);
  const recent = await store.recentBodies(author.id, new Date(now - 86_400_000).toISOString());
  if (recent.some((body) => normaliseForDuplicate(body) === fingerprint)) {
    return { ok: false, status: 422, error: "You already posted this.", code: "DUPLICATE" };
  }

  // The community, last: an IPO community is created by its first post, so
  // only once every other rule has passed. A reply's community is its
  // parent's (the database sets it).
  let communityId: string | null = null;
  let communityBoard: string | null = null;
  if (!parentId && ipoId) {
    if (!communities) {
      return { ok: false, status: 503, error: "IPO communities aren't switched on yet.", code: "NOT_CONFIGURED" };
    }
    const resolved = await communities.forIpo(ipoId);
    if (!resolved.ok) return { ok: false, status: resolved.status, error: resolved.error, code: resolved.code };
    communityId = resolved.community.id;
    const { exchange, symbol } = resolved.community;
    if (resolved.community.type === "stock" && exchange && symbol) communityBoard = stockBoardSymbol(exchange, symbol);
  } else if (!parentId && board && communities) {
    communityId = (await communities.forBoard(board))?.id ?? null;
  }

  const symbols = parentId
    ? Array.from(new Set([...parentSymbols, ...postSymbols(content.body)])).slice(0, 5)
    : postSymbols(content.body, board ?? communityBoard);

  const post = await store.insertPost({
    author_id: author.id,
    body: content.body,
    // Replies don't take a stance; the board's sentiment comes from posts.
    sentiment: parentId ? null : sentiment,
    symbols,
    parent_id: parentId,
    ...(communityId ? { community_id: communityId } : {}),
  });

  return { ok: true, post };
}

/* ------------------------------------------------------------------ */
/* Supabase-backed store                                               */
/* ------------------------------------------------------------------ */

const POST_COLUMNS =
  "id, body, sentiment, symbols, parent_id, like_count, reply_count, created_at, author:profiles!posts_author_id_fkey(username, display_name, avatar_url, role, pred_resolved, pred_wins, pred_points)";

// The same without the prediction counters, for a database where the
// predictions migration hasn't been applied yet (42703 = undefined column).
const POST_COLUMNS_BASIC =
  "id, body, sentiment, symbols, parent_id, like_count, reply_count, created_at, author:profiles!posts_author_id_fkey(username, display_name, avatar_url, role)";

const UNDEFINED_COLUMN = "42703";

type AuthorJoin = {
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: PostView["author"]["role"];
  pred_resolved?: number;
  pred_wins?: number;
  pred_points?: number;
};

type PostRow = {
  id: string;
  body: string;
  sentiment: Sentiment | null;
  symbols: string[] | null;
  parent_id: string | null;
  like_count: number;
  reply_count: number;
  created_at: string;
  author: AuthorJoin | AuthorJoin[] | null;
};

export function toPostView(row: PostRow): PostView {
  const author = Array.isArray(row.author) ? row.author[0] : row.author;

  return {
    id: row.id,
    body: row.body,
    sentiment: row.sentiment,
    symbols: row.symbols ?? [],
    parentId: row.parent_id,
    likeCount: row.like_count,
    replyCount: row.reply_count,
    createdAt: row.created_at,
    author: {
      username: author?.username ?? "deleted",
      displayName: author?.display_name ?? "Deleted user",
      avatarUrl: author?.avatar_url ?? null,
      role: author?.role ?? "user",
      stats: {
        resolved: author?.pred_resolved ?? 0,
        wins: author?.pred_wins ?? 0,
        points: author?.pred_points ?? 0,
      },
    },
  };
}

/**
 * PostgREST filter for a community's feed. Symbols have passed isValidSymbol
 * (letters, digits, ".", "&", "-") and are quoted, so none can break out.
 */
export function scopeFilter({ communityId, anySymbols }: CommunityScope): string {
  if (!UUID.test(communityId)) throw new Error("Invalid community id");
  const own = `community_id.eq.${communityId}`;
  const tags = anySymbols.filter(isValidSymbol);
  return tags.length ? `${own},symbols.ov.{${tags.map((s) => `"${s}"`).join(",")}}` : own;
}

export function getSupabaseStore(): CommunityStore | null {
  const admin = getAdminClient();
  const reader = getPublicClient();
  if (!admin || !reader) return null;

  function listWith(columns: string, { symbol, community, parentId, sentiment, before, limit }: ListQuery) {
    let query = reader!.from("posts").select(columns);

    query = parentId
      ? query.eq("parent_id", parentId).order("created_at", { ascending: true })
      : query.is("parent_id", null).order("created_at", { ascending: false });

    if (community) query = query.or(scopeFilter(community));
    else if (symbol) query = query.contains("symbols", [symbol]);
    if (sentiment) query = query.eq("sentiment", sentiment);
    if (before) query = query.lt("created_at", before);

    return query.limit(limit);
  }

  function unwrap(result: { data: unknown[] | null; error: { code?: string } | null }): PostView[] {
    if (result.error) throw result.error;
    return (result.data ?? []).map((row) => toPostView(row as unknown as PostRow));
  }

  return {
    async verifyToken(token) {
      const { data, error } = await admin.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },

    async getAuthor(userId) {
      const { data } = await admin
        .from("profiles")
        .select("id, created_at")
        .eq("id", userId)
        .maybeSingle();
      return data ? { id: data.id, createdAt: data.created_at } : null;
    },

    async countPostsSince(authorId, sinceIso) {
      const { count, error } = await admin
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("author_id", authorId)
        .gte("created_at", sinceIso);
      if (error) throw error;
      return count ?? 0;
    },

    async recentBodies(authorId, sinceIso) {
      const { data, error } = await admin
        .from("posts")
        .select("body")
        .eq("author_id", authorId)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []).map((row) => row.body as string);
    },

    async getParent(postId) {
      const { data } = await reader
        .from("posts")
        .select("symbols, parent_id")
        .eq("id", postId)
        .maybeSingle();
      // Replies are one level deep: replying to a reply is refused.
      return data && data.parent_id === null ? { symbols: data.symbols ?? [] } : null;
    },

    async insertPost(row) {
      const { data, error } = await admin.from("posts").insert(row).select("id").single();
      if (error) throw error;

      let full = await admin.from("posts").select(POST_COLUMNS).eq("id", data.id).single();
      if (full.error?.code === UNDEFINED_COLUMN) {
        full = await admin.from("posts").select(POST_COLUMNS_BASIC).eq("id", data.id).single();
      }
      if (full.error) throw full.error;
      return toPostView(full.data as unknown as PostRow);
    },

    async listPosts(query) {
      const result = await listWith(POST_COLUMNS, query);
      return result.error?.code === UNDEFINED_COLUMN ? unwrap(await listWith(POST_COLUMNS_BASIC, query)) : unwrap(result);
    },

    async sentiment(scope, sinceIso) {
      const base = () => {
        const query = reader
          .from("posts")
          .select("id", { count: "exact", head: true })
          .is("parent_id", null)
          .gte("created_at", sinceIso);
        return typeof scope === "string" ? query.contains("symbols", [scope]) : query.or(scopeFilter(scope));
      };

      const [bull, bear, all] = await Promise.all([
        base().eq("sentiment", "bullish"),
        base().eq("sentiment", "bearish"),
        base(),
      ]);
      const error = bull.error ?? bear.error ?? all.error;
      if (error) throw error;
      return { bullish: bull.count ?? 0, bearish: bear.count ?? 0, total: all.count ?? 0 };
    },

    async recentSymbols(sinceIso, limit) {
      const { data, error } = await reader
        .from("posts")
        .select("symbols")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((row) => (row.symbols as string[] | null) ?? []);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Read helpers                                                        */
/* ------------------------------------------------------------------ */

export const SENTIMENT_WINDOW_DAYS = 7;

export async function getSentiment(
  symbol: string,
  store: CommunityStore,
  now: number = Date.now(),
  scope?: CommunityScope
): Promise<SentimentSummary> {
  const since = new Date(now - SENTIMENT_WINDOW_DAYS * 86_400_000).toISOString();
  const counts = await store.sentiment(scope ?? symbol, since);
  return { symbol, windowDays: SENTIMENT_WINDOW_DAYS, ...counts };
}

/** Most-discussed symbols in the last 24 hours, from the latest 500 posts. */
export async function getTrending(
  store: CommunityStore,
  now: number = Date.now(),
  top = 10
): Promise<TrendingSymbol[]> {
  const rows = await store.recentSymbols(new Date(now - 86_400_000).toISOString(), 500);
  const counts = new Map<string, number>();

  for (const symbols of rows) {
    for (const symbol of new Set(symbols)) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([symbol, posts]) => ({ symbol, posts }))
    .sort((a, b) => b.posts - a.posts || a.symbol.localeCompare(b.symbol))
    .slice(0, top);
}
