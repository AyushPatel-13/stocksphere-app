import { getAdminClient, getPublicClient } from "../supabase/server";
import { isValidSymbol } from "../validation/symbol";
import { stockBoardSymbol } from "./communities";
import type { CommunityResolver } from "./ipoCommunity";
import { imageOwner, imageUrl, parseImageInputs, readPostImages, type PostImage } from "./images";
import { parseMentionInputs, readMentions, resolveMentions, type MentionResolver, type StoredMention } from "./mentions";
import {
  LINK_UNLOCK_DAYS,
  MAX_SYMBOLS,
  accountAgeDays,
  checkContent,
  checkRate,
  checkTitle,
  extractCashtags,
  isPostKind,
  normaliseForDuplicate,
  postSymbols,
  type PostKind,
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
  /** Only set when the post has verified @mentions (post_mentions migration). */
  mentions?: StoredMention[];
  mention_community_ids?: string[];
  /** Only set when given (post_titles_and_kinds migration); never on a comment. */
  title?: string;
  kind?: PostKind;
  /** A quote post: the top-level post it quotes (reposts migration). */
  quote_of?: string;
  /** Photos, already checked to be the author's own unused uploads (community_images migration). */
  images?: PostImage[];
};

/** What an author's edit changes. Mentions are replaced as a whole. */
export type PostEdit = {
  /** Only present when the edit sets them (null clears); never on a comment. */
  title?: string | null;
  kind?: PostKind | null;
  body: string;
  symbols: string[];
  mentions: StoredMention[];
  mention_community_ids: string[];
  edited_at: string;
};

/** The fields an edit needs to check ownership and recompute symbols. */
export type EditablePost = {
  authorId: string;
  parentId: string | null;
  body: string;
  symbols: string[];
  mentions: StoredMention[];
  hidden: boolean;
  /** A deleted comment kept as a placeholder (threaded_comments migration). */
  deleted?: boolean;
};

/**
 * The post or comment a reply answers. Everything but `symbols` is optional
 * so stores written before threading still type-check; a missing `parentId`
 * means a top-level post.
 */
export type ParentRecord = {
  symbols: string[];
  authorId?: string;
  /** Its own parent: null for a top-level post. */
  parentId?: string | null;
  /** Its thread's top-level post (null for a top-level post). */
  rootId?: string | null;
  deleted?: boolean;
  /** Whether the database knows threads (threaded_comments migration). */
  threads?: boolean;
};

/** An in-app notification (the notifications table from the alerts migration). */
export type ReplyNotification = { user_id: string; title: string; body: string; link: string };

/** A community's feed: its own posts, plus (once listed) posts tagged with its ticker. */
export type CommunityScope = { communityId: string; anySymbols: string[] };

/**
 * The community floor's asset filter, from stored relations only:
 *   stock  posts tagged with a listed instrument (posts.symbols — stock
 *          boards, $CASHTAGS, @mentions of stocks, ETFs, indices, crypto)
 *   ipo    posts written in an IPO's community or that @mention an IPO
 *   bond   posts that @mention a bond
 */
export type AssetFilter = "stock" | "ipo" | "bond";

export const ASSET_FILTERS: readonly AssetFilter[] = ["stock", "ipo", "bond"];

export type ListQuery = {
  symbol?: string;
  /** Overrides `symbol` when set. */
  community?: CommunityScope;
  /** Only on the floor (no symbol, community or parent). */
  asset?: AssetFilter;
  parentId?: string;
  /** Every comment in a top-level post's thread, at any depth, oldest first. */
  thread?: string;
  /** With `thread`: comments created at or after this time (the next page). */
  after?: string;
  /** One post or comment by id. */
  id?: string;
  sentiment?: Sentiment;
  /** Top-level posts of one type. */
  kind?: PostKind;
  /** A member's own writing (a profile id), newest first: their posts, and with `withReplies` their comments too. */
  author?: string;
  withReplies?: boolean;
  /** These posts, in any order (a profile's Liked tab). */
  ids?: string[];
  /** Posts with a verified instrument mention on this exchange. */
  exchange?: Exchange;
  before?: string;
  limit: number;
};

export interface CommunityStore {
  /** The user a Supabase access token belongs to, or null if invalid. */
  verifyToken(token: string): Promise<string | null>;
  getAuthor(userId: string): Promise<AuthorRecord | null>;
  countPostsSince(authorId: string, sinceIso: string): Promise<number>;
  recentBodies(authorId: string, sinceIso: string): Promise<string[]>;
  /** A visible post or comment, or null when it doesn't exist (or is hidden). */
  getParent(postId: string): Promise<ParentRecord | null>;
  insertPost(row: NewPostRow): Promise<PostView>;
  listPosts(query: ListQuery): Promise<PostView[]>;
  sentiment(scope: string | CommunityScope, sinceIso: string): Promise<Omit<SentimentSummary, "symbol" | "windowDays">>;
  recentSymbols(sinceIso: string, limit: number): Promise<string[][]>;
  /** Edits (post_mentions migration). Optional so older fakes and stores still type-check. */
  getPostForEdit?(postId: string): Promise<EditablePost | null>;
  updatePost?(postId: string, authorId: string, edit: PostEdit): Promise<PostView | null>;
  /** Tell someone their post or comment was answered. Optional; a failure never fails the reply. */
  notify?(row: ReplyNotification): Promise<void>;
  /** The author's own uploads among `paths` that no post uses yet (community_images migration). */
  unusedUploads?(userId: string, paths: string[]): Promise<{ path: string; width: number; height: number }[]>;
  /** Link uploads to the post that now uses them; returns how many were linked. */
  attachUploads?(postId: string, userId: string, paths: string[]): Promise<number>;
  /** Remove a post that couldn't be completed (its photos couldn't be linked). */
  discardPost?(postId: string, userId: string): Promise<void>;
  /** The members these @handles belong to (profiles are public); unknown handles are left out. */
  profilesByHandle?(handles: string[]): Promise<{ id: string; username: string }[]>;
  /** A profile's id by @handle (profiles are public), or null. */
  profileId?(username: string): Promise<string | null>;
  /** One page of ranked top-level post ids (community_feed migration). Throws NOT_CONFIGURED before it. */
  rankPosts?(query: RankQuery): Promise<string[]>;
  /** Whom a member follows (profile ids). */
  followees?(userId: string): Promise<string[]>;
  /** The symbols on a member's watchlist (their followed stocks). */
  watchSymbols?(userId: string): Promise<string[]>;
  /** What a member reposted, newest first, before `beforeIso` (reposts are public). */
  reposts?(userId: string, beforeIso: string | undefined, limit: number): Promise<{ postId: string; likedAt: string }[]>;
  /** What a member liked, newest like first, before `beforeIso` (likes are public). */
  likes?(userId: string, beforeIso: string | undefined, limit: number): Promise<{ postId: string; likedAt: string }[]>;
}

export type CreatePostInput = {
  token: string | null;
  body: unknown;
  sentiment?: unknown;
  symbol?: unknown;
  parentId?: unknown;
  /** With parentId: the top-level post the reply is written under (checked against the parent). */
  postId?: unknown;
  /** An Upstox IPO id: post in that IPO's community. */
  ipoId?: unknown;
  /** Picks from the @ autocomplete: [{ kind, id | ipoId, text }]. */
  mentions?: unknown;
  /** Optional headline and post type; top-level posts only. */
  title?: unknown;
  kind?: unknown;
  /** Quote this top-level post (a post of your own that embeds it). */
  quoteOf?: unknown;
  /** Photos uploaded through /api/community/images: [{ path, alt? }], at most 4, top-level posts only. */
  images?: unknown;
};

export type CreatePostResult =
  | { ok: true; post: PostView }
  | { ok: false; status: number; error: string; code?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createPost(
  input: CreatePostInput,
  store: CommunityStore | null,
  now: number = Date.now(),
  communities: CommunityResolver | null = null,
  mentionResolver: MentionResolver | null = null
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

  const mentionInputs = parseMentionInputs(input.mentions);
  if (!mentionInputs.ok) return mentionInputs;

  const meta = readPostMeta(input.title, input.kind);
  if (!meta.ok) return meta;

  const imageInputs = parseImageInputs(input.images);
  if (!imageInputs.ok) return imageInputs;

  let quoteOf: string | null = null;
  let quotedAuthor: string | null = null;
  if (input.quoteOf !== undefined && input.quoteOf !== null) {
    if (typeof input.quoteOf !== "string" || !UUID.test(input.quoteOf)) return { ok: false, status: 400, error: "Invalid quote." };
    if (input.parentId !== undefined && input.parentId !== null) return { ok: false, status: 400, error: "Replies can't quote a post." };
    // Read through the public client, so a hidden post can't be quoted.
    const quoted = await store.getParent(input.quoteOf);
    if (!quoted || quoted.deleted) return { ok: false, status: 404, error: "The post you're quoting is no longer available." };
    if (quoted.parentId != null) return { ok: false, status: 400, error: "Only posts can be quoted, not comments." };
    quoteOf = input.quoteOf;
    quotedAuthor = quoted.authorId ?? null;
  }

  let parentId: string | null = null;
  let parentSymbols: string[] = [];
  let parent: ParentRecord | null = null;
  let rootId: string | null = null;

  if (input.parentId !== undefined && input.parentId !== null) {
    if (typeof input.parentId !== "string" || !UUID.test(input.parentId)) {
      return { ok: false, status: 400, error: "Invalid reply." };
    }
    if (input.postId !== undefined && input.postId !== null && (typeof input.postId !== "string" || !UUID.test(input.postId))) {
      return { ok: false, status: 400, error: "Invalid reply." };
    }
    parent = await store.getParent(input.parentId);
    if (!parent) return { ok: false, status: 404, error: "That post no longer exists." };
    if (parent.deleted) return { ok: false, status: 404, error: "That comment was deleted." };
    const nested = parent.parentId != null;
    if (nested && !parent.threads) {
      return { ok: false, status: 503, error: "Replies to replies aren't switched on yet.", code: "NOT_CONFIGURED" };
    }
    rootId = nested ? (parent.rootId ?? null) : input.parentId;
    // A reply is written under one post; its parent must be in that post's thread.
    if (!rootId || (typeof input.postId === "string" && input.postId.toLowerCase() !== rootId.toLowerCase())) {
      return { ok: false, status: 400, error: "That comment belongs to another post.", code: "WRONG_THREAD" };
    }
    parentId = input.parentId;
    parentSymbols = parent.symbols;
    if (meta.title || meta.kind) return { ok: false, status: 400, error: "Comments don't take a title or post type." };
    if (imageInputs.images.length) return { ok: false, status: 400, error: "Photos can be added to posts, not comments." };
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

  // Photos: each must be this author's own upload that no post uses yet.
  let images: PostImage[] = [];
  if (imageInputs.images.length) {
    if (imageInputs.images.some((image) => imageOwner(image.path) !== author.id.toLowerCase())) {
      return { ok: false, status: 403, error: "You can only post your own photos." };
    }
    if (!store.unusedUploads || !store.attachUploads) return IMAGES_OFF;
    let found: { path: string; width: number; height: number }[];
    try {
      found = await store.unusedUploads(author.id, imageInputs.images.map((image) => image.path));
    } catch (error) {
      if ((error as { code?: string })?.code === "NOT_CONFIGURED") return IMAGES_OFF;
      throw error;
    }
    const byPath = new Map(found.map((record) => [record.path, record]));
    if (imageInputs.images.some((image) => !byPath.has(image.path))) {
      return { ok: false, status: 409, error: "One of the photos is no longer available. Remove it and add it again.", code: "IMAGE_GONE" };
    }
    images = imageInputs.images.map((image) => ({ path: image.path, width: byPath.get(image.path)!.width, height: byPath.get(image.path)!.height, alt: image.alt }));
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

  // Mentions are verified against real records (and an IPO's community is
  // created, like a first post in it) only once the post is otherwise fine.
  const mentioned = await resolveMentions(mentionInputs.inputs, content.body, mentionResolver);
  if (!mentioned.ok) return mentioned;

  const base = parentId ? parentSymbols : [board ?? communityBoard].filter((s): s is string => Boolean(s));
  const symbols = Array.from(new Set([...base, ...mentioned.symbols, ...postSymbols(content.body)])).slice(0, MAX_SYMBOLS);

  let post: PostView;
  try {
    post = await store.insertPost({
      author_id: author.id,
      body: content.body,
      // Replies don't take a stance; the board's sentiment comes from posts.
      sentiment: parentId ? null : sentiment,
      symbols,
      parent_id: parentId,
      ...(communityId ? { community_id: communityId } : {}),
      ...(mentioned.mentions.length ? { mentions: mentioned.mentions, mention_community_ids: mentioned.communityIds } : {}),
      ...(meta.title ? { title: meta.title } : {}),
      ...(meta.kind ? { kind: meta.kind } : {}),
      ...(quoteOf ? { quote_of: quoteOf } : {}),
      ...(images.length ? { images } : {}),
    });
  } catch (error) {
    if (images.length && isMissingColumn(error)) return IMAGES_OFF;
    if (quoteOf && isMissingColumn(error)) return QUOTES_OFF;
    if ((meta.title || meta.kind) && isMissingColumn(error)) return KINDS_OFF;
    throw error;
  }

  // The photos now belong to the post. If they can't be linked, the post is taken back:
  // otherwise the cleanup job would later remove photos the post shows.
  if (images.length) {
    const paths = images.map((image) => image.path);
    let linked = 0;
    try {
      linked = await store.attachUploads!(post.id, author.id, paths);
      if (linked < paths.length) linked = (await store.attachUploads!(post.id, author.id, paths)) + linked;
    } catch (error) {
      console.error("Attaching photos failed:", error);
    }
    if (linked < paths.length) {
      await store.discardPost?.(post.id, author.id).catch(() => undefined);
      return { ok: false, status: 409, error: "Your photos couldn't be attached. Please try posting again.", code: "IMAGE_GONE" };
    }
  }

  // Who hears about it: the author answered, the author quoted, and members @mentioned by handle.
  // One notification per person, never yourself; a failure never fails the post.
  if (store.notify) {
    const rows: ReplyNotification[] = [];
    const told = new Set<string>([author.id]);
    if (parent?.authorId && rootId && !told.has(parent.authorId)) {
      rows.push(replyNotification({ ...parent, authorId: parent.authorId }, post, rootId));
      told.add(parent.authorId);
    }
    if (quotedAuthor && !told.has(quotedAuthor)) {
      rows.push(postNotification(quotedAuthor, `@${post.author.username} quoted your post`, post, rootId));
      told.add(quotedAuthor);
    }
    const handles = userHandles(content.body, mentioned.mentions);
    if (handles.length && store.profilesByHandle) {
      try {
        for (const member of await store.profilesByHandle(handles)) {
          if (told.has(member.id)) continue;
          rows.push(postNotification(member.id, `@${post.author.username} mentioned you`, post, rootId));
          told.add(member.id);
        }
      } catch (error) {
        console.error("Mention lookup error:", error);
      }
    }
    await Promise.all(
      rows.map((row) =>
        store.notify!(row).catch((error) => {
          console.error("Community notification error:", error);
        })
      )
    );
  }

  return { ok: true, post };
}

type PostMeta = { ok: true; title: string | null; kind: PostKind | null } | { ok: false; status: number; error: string; code?: string };

/** A post's optional title and type, checked. Blank or missing means none. */
export function readPostMeta(title: unknown, kind: unknown): PostMeta {
  const checked = checkTitle(title);
  if (!checked.ok) return { ok: false, status: 422, error: checked.reason, code: "RULES" };
  if (kind === undefined || kind === null || kind === "") return { ok: true, title: checked.title, kind: null };
  if (!isPostKind(kind)) return { ok: false, status: 400, error: "Unknown post type." };
  return { ok: true, title: checked.title, kind };
}

/** A write naming a column the database doesn't have yet (a migration waiting for approval). */
function isMissingColumn(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === UNDEFINED_COLUMN || code === "PGRST204";
}

const IMAGES_OFF = {
  ok: false,
  status: 503,
  error: "Photo uploads aren't switched on yet. Remove the photos and post again.",
  code: "NOT_CONFIGURED",
} as const;

const QUOTES_OFF = {
  ok: false,
  status: 503,
  error: "Quote posts aren't switched on yet.",
  code: "NOT_CONFIGURED",
} as const;

const KINDS_OFF = {
  ok: false,
  status: 503,
  error: "Titles and post types aren't switched on yet. Remove them and try again.",
  code: "NOT_CONFIGURED",
} as const;

/** Where a comment lives: its post's page, opened at that comment. */
export function commentPath(rootId: string, commentId: string): string {
  return `/community/post/${rootId}?comment=${commentId}`;
}

/** "@ayush replied to your comment", with the reply's text and a link to it. */
/** Most members one post can @mention by handle (and so notify). */
export const MAX_USER_MENTIONS = 5;

/**
 * The @handles a post names, lowercase and de-duplicated, at most
 * MAX_USER_MENTIONS. Text inside a verified stock/IPO/bond mention ("@SBIN")
 * isn't a handle, and neither is the "@" of an email address. They're only
 * candidates: the server notifies only handles that belong to a real member.
 */
export function userHandles(body: string, mentions: StoredMention[] = []): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(/(^|[^A-Za-z0-9_.@])@([A-Za-z][A-Za-z0-9_]{2,19})(?![A-Za-z0-9_])/g)) {
    const start = (match.index ?? 0) + match[1].length;
    if (mentions.some((m) => start < m.end && start + match[2].length + 1 > m.start)) continue;
    const handle = match[2].toLowerCase();
    if (!found.includes(handle)) found.push(handle);
    if (found.length === MAX_USER_MENTIONS) break;
  }
  return found;
}

/** "@ayush mentioned you" / "@ayush quoted your post", with the post's text and a link to it. */
export function postNotification(userId: string, title: string, post: PostView, rootId: string | null): ReplyNotification {
  const text = post.body.replace(/\s+/g, " ").trim();
  return {
    user_id: userId,
    title: title.slice(0, 140),
    body: text.length > 200 ? `${text.slice(0, 199)}…` : text,
    link: rootId ? commentPath(rootId, post.id) : `/community/post/${post.id}`,
  };
}

export function replyNotification(parent: ParentRecord & { authorId: string }, reply: PostView, rootId: string): ReplyNotification {
  const text = reply.body.replace(/\s+/g, " ").trim();
  return {
    user_id: parent.authorId,
    title: `@${reply.author.username} replied to your ${parent.parentId != null ? "comment" : "post"}`.slice(0, 140),
    body: text.length > 200 ? `${text.slice(0, 199)}…` : text,
    link: commentPath(rootId, reply.id),
  };
}

export type EditPostInput = {
  token: string | null;
  postId: unknown;
  body: unknown;
  mentions?: unknown;
  /** Left out: unchanged. Blank or null: removed. Top-level posts only. */
  title?: unknown;
  kind?: unknown;
};

/**
 * An author edits their own post: the text, and the mentions (kept, removed
 * or replaced — whatever the edited composer sends). The same content rules
 * as a new post apply, and a top-level post's title and type can change too.
 * The board the post was written on, its sentiment, its community and its
 * replies are unchanged.
 */
export async function editPost(
  input: EditPostInput,
  store: CommunityStore | null,
  now: number = Date.now(),
  mentionResolver: MentionResolver | null = null
): Promise<CreatePostResult> {
  if (!store?.getPostForEdit || !store.updatePost) {
    return { ok: false, status: 503, error: "Editing isn't switched on yet.", code: "NOT_CONFIGURED" };
  }
  if (!input.token) return { ok: false, status: 401, error: "Sign in to edit.", code: "SIGNED_OUT" };

  const userId = await store.verifyToken(input.token);
  if (!userId) return { ok: false, status: 401, error: "Your session expired. Please sign in again.", code: "SIGNED_OUT" };

  if (typeof input.postId !== "string" || !UUID.test(input.postId)) return { ok: false, status: 400, error: "Invalid post." };
  if (typeof input.body !== "string") return { ok: false, status: 400, error: "Write something first." };

  const mentionInputs = parseMentionInputs(input.mentions);
  if (!mentionInputs.ok) return mentionInputs;

  const meta = readPostMeta(input.title, input.kind);
  if (!meta.ok) return meta;

  const existing = await store.getPostForEdit(input.postId);
  // Someone else's post looks the same as a missing one.
  if (!existing || existing.hidden || existing.deleted || existing.authorId !== userId) {
    return { ok: false, status: 404, error: "That post no longer exists." };
  }
  if (existing.parentId && (meta.title || meta.kind)) return { ok: false, status: 400, error: "Comments don't take a title or post type." };
  // Only what the edit names is written, so an edit that leaves them alone works before the migration too.
  const metaEdit = existing.parentId
    ? {}
    : { ...(input.title !== undefined ? { title: meta.title } : {}), ...(input.kind !== undefined ? { kind: meta.kind } : {}) };

  const author = await store.getAuthor(userId);
  if (!author) return { ok: false, status: 403, error: "Pick your @handle before posting.", code: "NO_PROFILE" };

  const content = checkContent(input.body, accountAgeDays(author.createdAt, now) >= LINK_UNLOCK_DAYS);
  if (!content.ok) return { ok: false, status: 422, error: content.reason, code: "RULES" };

  const mentioned = await resolveMentions(mentionInputs.inputs, content.body, mentionResolver);
  if (!mentioned.ok) return mentioned;

  // What the old text added (cashtags, mentions) goes; the rest is the board
  // (or the parent's symbols) and stays.
  const derived = new Set([
    ...extractCashtags(existing.body),
    ...existing.mentions.flatMap((m) => (m.kind === "instrument" ? [m.symbol] : [])),
  ]);
  const kept = existing.symbols.filter((s) => !derived.has(s));
  const symbols = Array.from(new Set([...kept, ...mentioned.symbols, ...extractCashtags(content.body)])).slice(0, MAX_SYMBOLS);

  let post: PostView | null;
  try {
    post = await store.updatePost(input.postId, userId, {
      ...metaEdit,
      body: content.body,
      symbols,
      mentions: mentioned.mentions,
      mention_community_ids: mentioned.communityIds,
      edited_at: new Date(now).toISOString(),
    });
  } catch (error) {
    if (Object.keys(metaEdit).length && isMissingColumn(error)) return KINDS_OFF;
    throw error;
  }
  return post ? { ok: true, post } : { ok: false, status: 404, error: "That post no longer exists." };
}

/* ------------------------------------------------------------------ */
/* Supabase-backed store                                               */
/* ------------------------------------------------------------------ */

/** Where photos are served from (the public bucket's address). */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

const BASE_COLUMNS = "id, body, sentiment, symbols, parent_id, like_count, reply_count, created_at";
const AUTHOR = "author:profiles!posts_author_id_fkey(username, display_name, avatar_url, role, pred_resolved, pred_wins, pred_points)";
const AUTHOR_BASIC = "author:profiles!posts_author_id_fkey(username, display_name, avatar_url, role)";

/**
 * Column sets from newest schema to oldest, each with whether the mention
 * filter can be used. A database missing a later migration answers 42703
 * (undefined column) and the next set is tried, so boards keep working while
 * a migration waits for approval.
 */
const COLUMN_SETS: { columns: string; mentions: boolean; community: boolean; threads: boolean; kinds: boolean; reposts: boolean; images: boolean }[] = [
  { columns: `${BASE_COLUMNS}, images, repost_count, quote_of, up_count, down_count, title, kind, root_id, comment_count, deleted_at, community_id, mentions, edited_at, ${AUTHOR}`, mentions: true, community: true, threads: true, kinds: true, reposts: true, images: true },
  { columns: `${BASE_COLUMNS}, repost_count, quote_of, up_count, down_count, title, kind, root_id, comment_count, deleted_at, community_id, mentions, edited_at, ${AUTHOR}`, mentions: true, community: true, threads: true, kinds: true, reposts: true, images: false },
  { columns: `${BASE_COLUMNS}, up_count, down_count, title, kind, root_id, comment_count, deleted_at, community_id, mentions, edited_at, ${AUTHOR}`, mentions: true, community: true, threads: true, kinds: true, reposts: false, images: false },
  { columns: `${BASE_COLUMNS}, title, kind, root_id, comment_count, deleted_at, community_id, mentions, edited_at, ${AUTHOR}`, mentions: true, community: true, threads: true, kinds: true, reposts: false, images: false },
  { columns: `${BASE_COLUMNS}, root_id, comment_count, deleted_at, community_id, mentions, edited_at, ${AUTHOR}`, mentions: true, community: true, threads: true, kinds: false, reposts: false, images: false },
  { columns: `${BASE_COLUMNS}, community_id, mentions, edited_at, ${AUTHOR}`, mentions: true, community: true, threads: false, kinds: false, reposts: false, images: false },
  { columns: `${BASE_COLUMNS}, community_id, ${AUTHOR}`, mentions: false, community: true, threads: false, kinds: false, reposts: false, images: false },
  { columns: `${BASE_COLUMNS}, ${AUTHOR}`, mentions: false, community: false, threads: false, kinds: false, reposts: false, images: false },
  { columns: `${BASE_COLUMNS}, ${AUTHOR_BASIC}`, mentions: false, community: false, threads: false, kinds: false, reposts: false, images: false },
];

/** Matches no row: a filter the schema can't answer yet has no posts. */
const NONE = "00000000-0000-0000-0000-000000000000";

/**
 * The asset filter as PostgREST filters. Fixed strings only — nothing from
 * the request is interpolated. jsonb containment (mentions @> …) uses the
 * GIN index from the bond_communities migration.
 */
export function assetFilter(asset: AssetFilter, set: { mentions: boolean; community: boolean }): { column: string; op: string; value: string } | { or: string } {
  if (asset === "stock") return { column: "symbols", op: "not.eq", value: "{}" };
  if (asset === "bond") return set.mentions ? { column: "mentions", op: "cs", value: '[{"kind":"bond"}]' } : { column: "id", op: "eq", value: NONE };
  if (set.mentions) return { or: 'community_id.not.is.null,mentions.cs.[{"kind":"ipo"}]' };
  return set.community ? { column: "community_id", op: "not.is", value: "null" } : { column: "id", op: "eq", value: NONE };
}

const UNDEFINED_COLUMN = "42703";

type EditRow = {
  author_id: string;
  parent_id: string | null;
  body: string;
  symbols: string[] | null;
  mentions: unknown;
  hidden: boolean;
  deleted_at?: string | null;
};

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
  images?: unknown;
  repost_count?: number;
  quote_of?: string | null;
  up_count?: number;
  down_count?: number;
  title?: string | null;
  kind?: string | null;
  body: string;
  sentiment: Sentiment | null;
  symbols: string[] | null;
  parent_id: string | null;
  like_count: number;
  reply_count: number;
  created_at: string;
  community_id?: string | null;
  mentions?: unknown;
  edited_at?: string | null;
  root_id?: string | null;
  comment_count?: number;
  deleted_at?: string | null;
  author: AuthorJoin | AuthorJoin[] | null;
};

const DELETED_AUTHOR: PostView["author"] = {
  username: "deleted",
  displayName: "Deleted",
  avatarUrl: null,
  role: "user",
  stats: { resolved: 0, wins: 0, points: 0 },
};

export function toPostView(row: PostRow): PostView {
  const author = Array.isArray(row.author) ? row.author[0] : row.author;
  // Before the threaded_comments migration every reply hangs off its post.
  const rootId = row.root_id !== undefined ? row.root_id : row.parent_id;
  const thread = row.parent_id === null ? { commentCount: row.comment_count ?? row.reply_count } : {};

  // A deleted comment kept for its replies: no text, no author, no tags.
  if (row.deleted_at) {
    return {
      id: row.id,
      body: "",
      sentiment: null,
      symbols: [],
      communityId: row.community_id ?? null,
      mentions: [],
      editedAt: null,
      parentId: row.parent_id,
      rootId,
      likeCount: row.like_count,
      replyCount: row.reply_count,
      createdAt: row.created_at,
      deleted: true,
      author: DELETED_AUTHOR,
    };
  }

  return {
    id: row.id,
    ...(row.parent_id === null && row.title !== undefined ? { title: row.title ?? null, kind: isPostKind(row.kind) ? row.kind : null } : {}),
    body: row.body,
    sentiment: row.sentiment,
    symbols: row.symbols ?? [],
    communityId: row.community_id ?? null,
    mentions: readMentions(row.mentions, row.body),
    editedAt: row.edited_at ?? null,
    parentId: row.parent_id,
    rootId,
    ...thread,
    likeCount: row.like_count,
    // Before the post_votes migration there are no votes to show.
    ...(row.up_count !== undefined ? { upCount: row.up_count, downCount: row.down_count ?? 0 } : {}),
    // Photos (community_images migration), with their public addresses.
    ...(row.images !== undefined && readPostImages(row.images).length ? { images: readPostImages(row.images).map((image) => ({ ...image, url: imageUrl(image.path, SUPABASE_URL) })) } : {}),
    // Before the reposts migration there is nothing to repost, quote or save.
    ...(row.repost_count !== undefined && row.parent_id === null ? { repostCount: row.repost_count, quoteOf: row.quote_of ?? null } : {}),
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
export function scopeFilter({ communityId, anySymbols }: CommunityScope, withMentions = false): string {
  if (!UUID.test(communityId)) throw new Error("Invalid community id");
  // Posts written in the community, and (post_mentions migration) posts that @mention it.
  const own = withMentions ? `community_id.eq.${communityId},mention_community_ids.cs.{${communityId}}` : `community_id.eq.${communityId}`;
  const tags = anySymbols.filter(isValidSymbol);
  return tags.length ? `${own},symbols.ov.{${tags.map((s) => `"${s}"`).join(",")}}` : own;
}

/** Try each column set until the database knows all its columns. */
async function withFallback<T extends { error: { code?: string } | null }>(run: (set: (typeof COLUMN_SETS)[number]) => PromiseLike<T>): Promise<T> {
  let result = await run(COLUMN_SETS[0]);
  for (let i = 1; i < COLUMN_SETS.length && result.error?.code === UNDEFINED_COLUMN; i++) result = await run(COLUMN_SETS[i]);
  return result;
}

export function getSupabaseStore(): CommunityStore | null {
  const admin = getAdminClient();
  const reader = getPublicClient();
  if (!admin || !reader) return null;

  function listWith(set: (typeof COLUMN_SETS)[number], { symbol, community, asset, parentId, thread, after, id, sentiment, kind, before, limit, author, withReplies, ids, exchange }: ListQuery) {
    const { columns, mentions } = set;
    let query = reader!.from("posts").select(columns);

    if (id) return query.eq("id", id).limit(1);
    if (ids) {
      // Deleted comments kept as placeholders aren't anyone's liked post.
      query = query.in("id", ids.filter((v) => UUID.test(v)));
      return (set.threads ? query.is("deleted_at", null) : query).limit(limit);
    }
    if (author) {
      query = query.eq("author_id", author).order("created_at", { ascending: false });
      if (!withReplies) query = query.is("parent_id", null);
      if (set.threads) query = query.is("deleted_at", null);
      if (before) query = query.lt("created_at", before);
      return query.limit(limit);
    }
    if (thread) {
      // Before the migration a thread is one level: the post's direct replies.
      query = (set.threads ? query.eq("root_id", thread) : query.eq("parent_id", thread))
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      // Inclusive, so comments sharing the page boundary's timestamp are never skipped (the client drops repeats).
      if (after) query = query.gte("created_at", after);
      return query.limit(limit);
    }

    query = parentId
      ? query.eq("parent_id", parentId).order("created_at", { ascending: true })
      : query.is("parent_id", null).order("created_at", { ascending: false });

    if (community) query = query.or(scopeFilter(community, mentions));
    else if (symbol) query = query.contains("symbols", [symbol]);
    else if (asset && !parentId) {
      const filter = assetFilter(asset, set);
      query = "or" in filter ? query.or(filter.or) : query.filter(filter.column, filter.op, filter.value);
    }
    if (sentiment) query = query.eq("sentiment", sentiment);
    // jsonb containment as a JSON literal (contains() would send a Postgres array); exchange is NSE or BSE, never request text.
    if (exchange) query = mentions ? query.filter("mentions", "cs", JSON.stringify([{ kind: "instrument", exchange }])) : query.eq("id", NONE);
    // Before the post_titles_and_kinds migration no post has a type.
    if (kind && !parentId) query = set.kinds ? query.eq("kind", kind) : query.eq("id", NONE);
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
      // Through the public client, so a hidden post or comment can't be answered.
      const threaded = await reader.from("posts").select("symbols, parent_id, author_id, root_id, deleted_at").eq("id", postId).maybeSingle();
      if (threaded.error?.code !== UNDEFINED_COLUMN) {
        if (threaded.error) throw threaded.error;
        const row = threaded.data;
        return row
          ? { symbols: row.symbols ?? [], authorId: row.author_id, parentId: row.parent_id, rootId: row.root_id, deleted: Boolean(row.deleted_at), threads: true }
          : null;
      }
      // Before the threaded_comments migration: one level only (createPost refuses deeper).
      const { data, error } = await reader.from("posts").select("symbols, parent_id, author_id").eq("id", postId).maybeSingle();
      if (error) throw error;
      return data ? { symbols: data.symbols ?? [], authorId: data.author_id, parentId: data.parent_id, rootId: null, threads: false } : null;
    },

    async insertPost(row) {
      const { data, error } = await admin.from("posts").insert(row).select("id").single();
      if (error) throw error;

      const full = await withFallback(({ columns }) => admin.from("posts").select(columns).eq("id", data.id).single());
      if (full.error) throw full.error;
      return toPostView(full.data as unknown as PostRow);
    },

    async listPosts(query) {
      return unwrap(await withFallback((set) => listWith(set, query)));
    },

    async getPostForEdit(postId) {
      let result = await admin.from("posts").select("author_id, parent_id, body, symbols, mentions, hidden, deleted_at").eq("id", postId).maybeSingle();
      if (result.error?.code === UNDEFINED_COLUMN) {
        result = await admin.from("posts").select("author_id, parent_id, body, symbols, mentions, hidden").eq("id", postId).maybeSingle();
      }
      const { data, error } = result as { data: EditRow | null; error: { code?: string } | null };
      if (error) throw error;
      return data
        ? {
            authorId: data.author_id,
            parentId: data.parent_id,
            body: data.body,
            symbols: data.symbols ?? [],
            mentions: readMentions(data.mentions, data.body),
            hidden: data.hidden,
            deleted: Boolean(data.deleted_at),
          }
        : null;
    },

    async updatePost(postId, authorId, edit) {
      // Ownership is in the filter too: a row that changed hands updates nothing.
      const { data, error } = await admin.from("posts").update(edit).eq("id", postId).eq("author_id", authorId).eq("hidden", false).select("id");
      if (error) throw error;
      if (!data?.length) return null;
      const full = await withFallback(({ columns }) => admin.from("posts").select(columns).eq("id", postId).single());
      if (full.error) throw full.error;
      return toPostView(full.data as unknown as PostRow);
    },

    async rankPosts(q) {
      const { data, error } = await reader.rpc("community_feed", {
        p_sort: q.sort,
        p_since: q.since ?? null,
        p_any_authors: q.anyAuthors ?? null,
        p_any_symbols: q.anySymbols ?? null,
        p_any_community: q.anyCommunity ?? null,
        p_boost_authors: q.boostAuthors ?? null,
        p_boost_symbols: q.boostSymbols ?? null,
        p_sentiment: q.sentiment ?? null,
        p_kind: q.kind ?? null,
        p_exchange: q.exchange ?? null,
        p_limit: q.limit,
        p_offset: q.offset,
      });
      if (error) {
        // The function (or a column it needs) isn't there yet: its migrations wait for approval.
        if (RANKING_MISSING.includes(error.code ?? "")) throw Object.assign(new Error("Ranked feeds aren't switched on"), { code: "NOT_CONFIGURED" });
        throw error;
      }
      return ((data ?? []) as { post_id: string }[]).map((row) => row.post_id);
    },

    async followees(userId) {
      const { data, error } = await admin.from("follows").select("followee_id").eq("follower_id", userId).limit(FOLLOW_LIMIT);
      if (error) {
        if (MISSING_TABLE.includes(error.code ?? "")) return [];
        throw error;
      }
      return (data ?? []).map((row) => row.followee_id as string);
    },

    async watchSymbols(userId) {
      // The watchlist is private (RLS: owner only); this reads it only for the viewer whose token was verified.
      const { data, error } = await admin.from("watchlist").select("symbol").eq("user_id", userId).limit(FOLLOW_LIMIT);
      if (error) {
        if (MISSING_TABLE.includes(error.code ?? "")) return [];
        throw error;
      }
      return [...new Set((data ?? []).map((row) => String(row.symbol).trim().toUpperCase()).filter(isValidSymbol))];
    },

    async unusedUploads(userId, paths) {
      const { data, error } = await admin.from("community_uploads").select("path, width, height").eq("user_id", userId).is("post_id", null).is("attached_at", null).in("path", paths);
      if (error) {
        if (MISSING_TABLE.includes(error.code ?? "")) throw Object.assign(new Error("Photos aren't switched on"), { code: "NOT_CONFIGURED" });
        throw error;
      }
      return (data ?? []).map((r) => ({ path: r.path as string, width: r.width as number, height: r.height as number }));
    },

    async attachUploads(postId, userId, paths) {
      const { data, error } = await admin
        .from("community_uploads")
        .update({ post_id: postId, attached_at: new Date().toISOString() })
        .eq("user_id", userId)
        .is("post_id", null)
        .is("attached_at", null)
        .in("path", paths)
        .select("path");
      if (error) throw error;
      return data?.length ?? 0;
    },

    async discardPost(postId, userId) {
      await admin.from("posts").delete().eq("id", postId).eq("author_id", userId);
    },

    async profilesByHandle(handles) {
      if (!handles.length) return [];
      const { data, error } = await reader.from("profiles").select("id, username").in("username", handles.slice(0, MAX_USER_MENTIONS));
      if (error) throw error;
      return (data ?? []).map((row) => ({ id: row.id as string, username: row.username as string }));
    },

    async profileId(username) {
      const { data, error } = await reader.from("profiles").select("id").eq("username", username).maybeSingle();
      if (error) throw error;
      return (data?.id as string | undefined) ?? null;
    },

    async likes(userId, beforeIso, limit) {
      let query = reader.from("post_likes").select("post_id, created_at").eq("user_id", userId).order("created_at", { ascending: false });
      if (beforeIso) query = query.lt("created_at", beforeIso);
      const { data, error } = await query.limit(limit);
      if (error) throw error;
      return (data ?? []).map((row) => ({ postId: row.post_id as string, likedAt: row.created_at as string }));
    },

    async reposts(userId, beforeIso, limit) {
      let query = reader.from("reposts").select("post_id, created_at").eq("user_id", userId).order("created_at", { ascending: false });
      if (beforeIso) query = query.lt("created_at", beforeIso);
      const { data, error } = await query.limit(limit);
      if (error) {
        if (MISSING_TABLE.includes(error.code ?? "")) throw Object.assign(new Error("Reposts aren't switched on"), { code: "NOT_CONFIGURED" });
        throw error;
      }
      return (data ?? []).map((row) => ({ postId: row.post_id as string, likedAt: row.created_at as string }));
    },

    async notify(row) {
      // The alerts migration's in-app notifications (the navbar bell); without that table there is nowhere to put one.
      const { error } = await admin.from("notifications").insert({ ...row, kind: "community" });
      if (error && error.code !== "42P01" && error.code !== "PGRST205") throw error;
    },

    async sentiment(scope, sinceIso) {
      const count = async (withMentions: boolean) => {
        const base = () => {
          const query = reader
            .from("posts")
            .select("id", { count: "exact", head: true })
            .is("parent_id", null)
            .gte("created_at", sinceIso);
          return typeof scope === "string" ? query.contains("symbols", [scope]) : query.or(scopeFilter(scope, withMentions));
        };
        const [bull, bear, all] = await Promise.all([base().eq("sentiment", "bullish"), base().eq("sentiment", "bearish"), base()]);
        return { bull, bear, all, error: bull.error ?? bear.error ?? all.error };
      };

      let result = await count(typeof scope !== "string");
      if (result.error?.code === UNDEFINED_COLUMN && typeof scope !== "string") result = await count(false);
      if (result.error) throw result.error;
      return { bullish: result.bull.count ?? 0, bearish: result.bear.count ?? 0, total: result.all.count ?? 0 };
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

/* ------------------------------------------------ ranked feeds */

export type FeedName = "for-you" | "following" | "trending" | "latest" | "top";
export const FEEDS: readonly FeedName[] = ["for-you", "following", "trending", "latest", "top"];
export type FeedSort = "hot" | "new" | "top" | "discussed" | "trending";
export const FEED_SORTS: readonly FeedSort[] = ["hot", "new", "top", "discussed", "trending"];
export type FeedRange = "day" | "week" | "month" | "year" | "all";
export const FEED_RANGES: readonly FeedRange[] = ["day", "week", "month", "year", "all"];
export type Exchange = "NSE" | "BSE";

/** How many follows / watched symbols a feed considers. */
const FOLLOW_LIMIT = 500;
/** The ranking function, or a column it reads, isn't in the database yet. */
const RANKING_MISSING = ["PGRST202", "42883", "42703", "42P01"];
const MISSING_TABLE = ["42P01", "PGRST205"];

export type RankQuery = {
  sort: FeedSort;
  since?: string;
  anyAuthors?: string[];
  anySymbols?: string[];
  anyCommunity?: string;
  boostAuthors?: string[];
  boostSymbols?: string[];
  sentiment?: Sentiment;
  kind?: PostKind;
  exchange?: Exchange;
  limit: number;
  offset: number;
};

const RANGE_DAYS: Record<FeedRange, number | null> = { day: 1, week: 7, month: 30, year: 365, all: null };

/** The start of a Top / Most discussed range, or undefined for all time. */
export function rangeStart(range: FeedRange, now: number): string | undefined {
  const days = RANGE_DAYS[range];
  return days === null ? undefined : new Date(now - days * 86_400_000).toISOString();
}

export function defaultSort(feed: FeedName): FeedSort {
  return feed === "for-you" ? "hot" : feed === "trending" ? "trending" : feed === "top" ? "top" : "new";
}

export type FeedInput = {
  feed: FeedName;
  /** How to order it. Defaults: For You hot, Trending trending, Top top, Latest and Following new. */
  sort?: FeedSort;
  range?: FeedRange;
  /** The signed-in viewer, already verified from their token; null when signed out. */
  viewerId: string | null;
  /** A board's scope (its symbols and community) instead of a feed tab. */
  scope?: { anySymbols: string[]; anyCommunity?: string };
  sentiment?: Sentiment;
  kind?: PostKind;
  exchange?: Exchange;
  offset: number;
  limit: number;
};

export type FeedResult =
  | { ok: true; posts: PostView[]; hasMore: boolean; next: string | null; empty?: "no-follows" }
  | { ok: false; status: number; error: string; code?: string };

/**
 * One feed implementation for every tab and board: it works out whom and
 * what the viewer follows (server-side, for the verified viewer only), asks
 * community_feed for a ranked page of ids, then reads those posts in one
 * query and keeps the rank order. Paged by offset (`next`).
 */
export async function getFeed(store: CommunityStore | null, input: FeedInput, now: number = Date.now()): Promise<FeedResult> {
  if (!store?.rankPosts) return { ok: false, status: 503, error: "Ranked feeds aren't switched on yet.", code: "NOT_CONFIGURED" };

  const sort = input.sort ?? defaultSort(input.feed);
  const ranged = sort === "top" || sort === "discussed";
  const query: RankQuery = {
    sort,
    since: ranged ? rangeStart(input.range ?? "week", now) : undefined,
    sentiment: input.sentiment,
    kind: input.kind,
    exchange: input.exchange,
    limit: input.limit,
    offset: input.offset,
  };

  if (input.scope) {
    query.anySymbols = input.scope.anySymbols.length ? input.scope.anySymbols : undefined;
    query.anyCommunity = input.scope.anyCommunity;
  } else if (input.feed === "following" || input.feed === "for-you") {
    if (input.feed === "following" && !input.viewerId) {
      return { ok: false, status: 401, error: "Sign in to see posts from people and stocks you follow.", code: "SIGNED_OUT" };
    }
    if (input.viewerId) {
      const [authors, symbols] = await Promise.all([store.followees?.(input.viewerId) ?? [], store.watchSymbols?.(input.viewerId) ?? []]);
      if (input.feed === "following") {
        if (!authors.length && !symbols.length) return { ok: true, posts: [], hasMore: false, next: null, empty: "no-follows" };
        query.anyAuthors = authors.length ? authors : undefined;
        query.anySymbols = symbols.length ? symbols : undefined;
      } else {
        query.boostAuthors = authors.length ? authors : undefined;
        query.boostSymbols = symbols.length ? symbols : undefined;
      }
    }
  }

  let ids: string[];
  try {
    ids = await store.rankPosts(query);
  } catch (error) {
    if ((error as { code?: string })?.code === "NOT_CONFIGURED") {
      return { ok: false, status: 503, error: "This feed switches on once its database update is approved.", code: "NOT_CONFIGURED" };
    }
    throw error;
  }
  if (!ids.length) return { ok: true, posts: [], hasMore: false, next: null };

  const byId = new Map((await store.listPosts({ ids, limit: ids.length })).map((post) => [post.id, post]));
  const posts = ids.flatMap((id) => byId.get(id) ?? []);
  const hasMore = ids.length === input.limit;
  return { ok: true, posts, hasMore, next: hasMore ? String(input.offset + ids.length) : null };
}

export type ProfileTab = "posts" | "replies" | "liked" | "reposts";
export const PROFILE_TABS: readonly ProfileTab[] = ["posts", "replies", "liked", "reposts"];

export type ProfileFeedResult =
  | { ok: true; posts: PostView[]; hasMore: boolean; next: string | null }
  | { ok: false; status: number; error: string; code?: string };

/**
 * One tab of a member's profile: their posts; their posts and comments; the
 * posts they liked, or reposted, in the order they did it. `before` is the
 * previous page's `next` (a post's created_at, or for Liked a like's).
 * Hidden posts never appear (RLS), nor do deleted-comment placeholders.
 */
export async function getProfileFeed(
  store: CommunityStore | null,
  { username, tab, before, limit }: { username: string; tab: ProfileTab; before?: string; limit: number }
): Promise<ProfileFeedResult> {
  if (!store?.profileId || (tab === "liked" && !store.likes) || (tab === "reposts" && !store.reposts)) {
    return { ok: false, status: 503, error: "Profiles aren't set up yet.", code: "NOT_CONFIGURED" };
  }
  const userId = await store.profileId(username);
  if (!userId) return { ok: false, status: 404, error: "No member has that handle." };

  if (tab === "posts" || tab === "replies") {
    const posts = await store.listPosts({ author: userId, withReplies: tab === "replies", before, limit });
    return { ok: true, posts, hasMore: posts.length === limit, next: posts.length ? posts[posts.length - 1].createdAt : null };
  }

  let likes: { postId: string; likedAt: string }[];
  try {
    likes = tab === "liked" ? await store.likes!(userId, before, limit) : await store.reposts!(userId, before, limit);
  } catch (error) {
    if ((error as { code?: string })?.code === "NOT_CONFIGURED") return { ok: false, status: 503, error: "Reposts aren't switched on yet.", code: "NOT_CONFIGURED" };
    throw error;
  }
  if (!likes.length) return { ok: true, posts: [], hasMore: false, next: null };
  const found = new Map((await store.listPosts({ ids: likes.map((l) => l.postId), limit })).map((post) => [post.id, post]));
  // A liked post that was since hidden or deleted drops out; the cursor still moves past its like.
  const posts = likes.flatMap((like) => found.get(like.postId) ?? []);
  return { ok: true, posts, hasMore: likes.length === limit, next: likes[likes.length - 1].likedAt };
}

/**
 * Adds `quoted` to quote posts: the post each one quotes, read in one query
 * for the whole page. A quoted post that's hidden now comes back null, and
 * the card says the original is unavailable.
 */
export async function attachQuotes(store: CommunityStore, posts: PostView[]): Promise<PostView[]> {
  const ids = [...new Set(posts.flatMap((post) => (post.quoteOf ? [post.quoteOf] : [])))];
  if (!ids.length) return posts;
  let found = new Map<string, PostView>();
  try {
    found = new Map((await store.listPosts({ ids, limit: ids.length })).map((post) => [post.id, post]));
  } catch (error) {
    console.error("Quoted posts error:", error);
    return posts;
  }
  return posts.map((post) => (post.quoteOf ? { ...post, quoted: found.get(post.quoteOf) ?? null } : post));
}

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
