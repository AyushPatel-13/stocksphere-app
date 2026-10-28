"use client";

import { useEffect, useState } from "react";

import { getMyProfile, type Profile } from "../profiles";
import { supabase } from "../supabase";
import type { EntitySuggestion } from "./entities";
import type { IpoCommunityPage, PublicCommunity } from "./ipoCommunity";
import { toMentionInputs, type MentionPick } from "./mentionInput";
import type { PostKind, Sentiment } from "./rules";
import { removePhotos } from "./imageClient";
import type { Vote } from "./votes";
import type { PostView, SentimentSummary, TrendingSymbol } from "./types";

/**
 * Browser-side community helpers.
 *
 * Posting goes through /api/community/posts (the server enforces the rules).
 * Likes, reports and deleting your own post go straight to Supabase, where RLS
 * allows exactly those actions and nothing more.
 */

export type ApiError = { error: string; code?: string };

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export type FeedTab = "for-you" | "following" | "trending" | "latest" | "top";
export type FeedSortId = "hot" | "new" | "top" | "discussed" | "trending";
export type FeedRangeId = "day" | "week" | "month" | "year" | "all";

export async function fetchPosts(params: {
  symbol?: string;
  /** An Upstox IPO id: that IPO's community. */
  ipo?: string;
  /** A bond's ISIN: the posts that mention it. */
  bond?: string;
  /** The community floor's asset filter. */
  asset?: "stock" | "ipo" | "bond";
  parent?: string;
  sentiment?: Sentiment;
  kind?: PostKind;
  /** The floor's tab; a board passes only `sort`. */
  feed?: FeedTab;
  sort?: FeedSortId;
  range?: FeedRangeId;
  exchange?: "NSE" | "BSE";
  before?: string;
  /** Ranked feeds page by offset: the previous page's `next`. */
  offset?: string;
  limit?: number;
}): Promise<{ posts: PostView[]; hasMore: boolean; next: string | null; empty?: "no-follows" } | ApiError> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }

  // For You and Following are the viewer's own; the server verifies the token.
  const personal = params.feed === "for-you" || params.feed === "following";
  const token = personal ? await accessToken() : null;

  try {
    const response = await fetch(`/api/community/posts?${query.toString()}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    const data = await response.json();
    return data?.success
      ? { posts: data.posts as PostView[], hasMore: Boolean(data.hasMore), next: (data.next as string | null) ?? null, ...(data.empty ? { empty: data.empty } : {}) }
      : { error: data?.error ?? "Couldn't load posts.", code: data?.code };
  } catch {
    return { error: "Couldn't load posts." };
  }
}

/** One tab of a member's profile; pass the previous page's `next` as `before`. */
export async function fetchProfilePosts(params: {
  handle: string;
  tab: "posts" | "replies" | "liked" | "reposts";
  before?: string | null;
  limit?: number;
}): Promise<{ posts: PostView[]; hasMore: boolean; next: string | null } | ApiError> {
  const query = new URLSearchParams({ profile: params.handle, tab: params.tab, limit: String(params.limit ?? 20) });
  if (params.before) query.set("before", params.before);
  try {
    const data = await (await fetch(`/api/community/posts?${query.toString()}`, { cache: "no-store" })).json();
    return data?.success
      ? { posts: data.posts as PostView[], hasMore: Boolean(data.hasMore), next: (data.next as string | null) ?? null }
      : { error: data?.error ?? "Couldn't load posts.", code: data?.code };
  } catch {
    return { error: "Couldn't load posts. Check your connection." };
  }
}

/** Most comments a thread loads (THREAD_PAGE-sized pages on the server). */
export const MAX_THREAD_COMMENTS = 1000;

/**
 * Every comment under a top-level post, flat and oldest first, page by page
 * (each page starts at the last one's timestamp, so repeats are dropped
 * here). `truncated` when the thread is longer than MAX_THREAD_COMMENTS.
 */
export async function fetchThread(postId: string): Promise<{ comments: PostView[]; truncated: boolean } | ApiError> {
  const byId = new Map<string, PostView>();
  let after: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ thread: postId, ...(after ? { after } : {}) });
    let data: { success?: boolean; posts?: PostView[]; hasMore?: boolean; error?: string; code?: string } | null;
    try {
      data = await (await fetch(`/api/community/posts?${query.toString()}`, { cache: "no-store" })).json();
    } catch {
      return { error: "Couldn't load the comments." };
    }
    if (!data?.success) return { error: data?.error ?? "Couldn't load the comments.", code: data?.code };
    const page = data.posts ?? [];
    const before = byId.size;
    for (const post of page) byId.set(post.id, post);
    if (!data.hasMore || byId.size === before) return { comments: [...byId.values()], truncated: false };
    if (byId.size >= MAX_THREAD_COMMENTS) return { comments: [...byId.values()], truncated: true };
    after = page[page.length - 1].createdAt;
  }
}

/** One post or comment, for its own page. */
export async function fetchPost(id: string): Promise<{ post: PostView } | ApiError> {
  try {
    const response = await fetch(`/api/community/posts?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const data = await response.json();
    return data?.success ? { post: data.post as PostView } : { error: data?.error ?? "Couldn't load this post.", code: data?.code };
  } catch {
    return { error: "Couldn't load this post. Check your connection." };
  }
}

export async function publishPost(input: {
  body: string;
  /** Top-level posts only. */
  title?: string;
  kind?: PostKind | null;
  sentiment?: Sentiment | null;
  symbol?: string;
  ipoId?: string;
  /** The post or comment answered. */
  parentId?: string;
  /** With parentId: the top-level post the reply is written under. */
  postId?: string;
  mentions?: MentionPick[];
  /** Quote this top-level post. */
  quoteOf?: string;
  /** Photos already uploaded (POST /api/community/images). */
  images?: { path: string; alt: string }[];
}): Promise<{ post: PostView } | ApiError> {
  const token = await accessToken();
  if (!token) return { error: "Sign in to post.", code: "SIGNED_OUT" };

  const { mentions, ...rest } = input;
  try {
    const response = await fetch("/api/community/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...rest, ...(mentions?.length ? { mentions: toMentionInputs(mentions) } : {}) }),
    });
    const data = await response.json();
    return data?.success
      ? { post: data.post as PostView }
      : { error: data?.error ?? "Couldn't publish your post.", code: data?.code };
  } catch {
    return { error: "Couldn't publish your post. Check your connection." };
  }
}

/** Edit your own post: its text and its mentions (sent as a whole), and a post's title and type when they changed. */
export async function editMyPost(input: {
  id: string;
  body: string;
  mentions: MentionPick[];
  /** Left out: unchanged. "" / null: removed. */
  title?: string;
  kind?: PostKind | null;
}): Promise<{ post: PostView } | ApiError> {
  const token = await accessToken();
  if (!token) return { error: "Sign in to edit.", code: "SIGNED_OUT" };

  try {
    const response = await fetch("/api/community/posts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        id: input.id,
        body: input.body,
        mentions: toMentionInputs(input.mentions),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
      }),
    });
    const data = await response.json();
    return data?.success ? { post: data.post as PostView } : { error: data?.error ?? "Couldn't save your edit.", code: data?.code };
  } catch {
    return { error: "Couldn't save your edit. Check your connection." };
  }
}

/** The @ autocomplete's suggestions. */
export async function fetchEntities(query: string, signal?: AbortSignal): Promise<{ results: EntitySuggestion[]; partial: boolean } | ApiError> {
  try {
    const response = await fetch(`/api/community/entities?q=${encodeURIComponent(query)}`, { signal });
    const data = await response.json().catch(() => null);
    return data?.success
      ? { results: data.results as EntitySuggestion[], partial: Boolean(data.partial) }
      : { error: data?.error ?? "Search is unavailable right now." };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { error: "Search is unavailable right now." };
  }
}

/** A stock's sentiment, or an IPO community's with `{ ipo }`. */
export async function fetchSentiment(target: string | { ipo: string }): Promise<SentimentSummary | null> {
  const query = typeof target === "string" ? `symbol=${encodeURIComponent(target)}` : `ipo=${encodeURIComponent(target.ipo)}`;
  try {
    const data = await (await fetch(`/api/community/sentiment?${query}`)).json();
    return data?.success ? (data as SentimentSummary) : null;
  } catch {
    return null;
  }
}

export type IpoCommunityData = IpoCommunityPage;

export async function fetchIpoCommunity(ipoId: string): Promise<IpoCommunityData | ApiError> {
  try {
    const response = await fetch(`/api/community/ipo?id=${encodeURIComponent(ipoId)}`, { cache: "no-store" });
    const data = await response.json().catch(() => null);
    return data?.success
      ? (data as IpoCommunityData)
      : { error: data?.error ?? "Couldn't load this community.", code: data?.code };
  } catch {
    return { error: "Couldn't reach the server. Check your connection and try again." };
  }
}

/** The IPO community a stock was linked from, if any. */
export async function fetchStockCommunity(symbol: string): Promise<PublicCommunity | null> {
  try {
    const data = await (await fetch(`/api/community/resolve?symbol=${encodeURIComponent(symbol)}`)).json();
    return data?.success ? ((data.community as PublicCommunity | null) ?? null) : null;
  } catch {
    return null;
  }
}

export async function fetchTrending(): Promise<TrendingSymbol[] | null> {
  try {
    const data = await (await fetch("/api/community/trending")).json();
    return data?.success ? (data.trending as TrendingSymbol[]) : null;
  } catch {
    return null;
  }
}

/** Which of these posts the signed-in user has liked. */
export async function myLikes(userId: string, postIds: string[]): Promise<Set<string>> {
  if (postIds.length === 0) return new Set();
  const { data } = await supabase
    .from("post_likes")
    .select("post_id")
    .eq("user_id", userId)
    .in("post_id", postIds);
  return new Set((data ?? []).map((row) => row.post_id as string));
}

/** The viewer's votes on these posts or comments (votes are public, so this is a plain read). */
export async function myVotes(userId: string, postIds: string[]): Promise<Map<string, Vote>> {
  if (postIds.length === 0) return new Map();
  const { data, error } = await supabase.from("post_votes").select("post_id, value").eq("user_id", userId).in("post_id", postIds);
  if (error) return new Map();
  return new Map((data ?? []).map((row) => [row.post_id as string, (row.value === -1 ? -1 : 1) as Vote]));
}

/**
 * Vote, change your vote or (0) remove it, as yourself. RLS allows exactly
 * that: your own row, on a post you can see. Update first, insert if there
 * was nothing to update (an upsert would also write the key columns, which
 * members may not update), and update again if a double click won the race.
 */
export async function setVote(postId: string, value: Vote): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  if (value === 0) {
    const { error } = await supabase.from("post_votes").delete().eq("post_id", postId).eq("user_id", user.id);
    return !error;
  }
  const updated = await supabase.from("post_votes").update({ value }).eq("post_id", postId).eq("user_id", user.id).select("post_id");
  if (updated.error) return false;
  if (updated.data?.length) return true;

  const inserted = await supabase.from("post_votes").insert({ post_id: postId, user_id: user.id, value });
  if (!inserted.error) return true;
  if (inserted.error.code !== "23505") return false;
  const retried = await supabase.from("post_votes").update({ value }).eq("post_id", postId).eq("user_id", user.id);
  return !retried.error;
}

/** What the viewer has done to these posts: liked, voted, reposted, saved. One round of parallel reads per page. */
export type Marks = { liked: Set<string>; votes: Map<string, Vote>; reposted: Set<string>; saved: Set<string> };

export const NO_MARKS: Marks = { liked: new Set(), votes: new Map(), reposted: new Set(), saved: new Set() };

async function idsIn(table: "reposts" | "bookmarks", userId: string, postIds: string[]): Promise<Set<string>> {
  // Before the reposts migration the tables don't exist: nothing is reposted or saved.
  const { data, error } = await supabase.from(table).select("post_id").eq("user_id", userId).in("post_id", postIds);
  return error ? new Set() : new Set((data ?? []).map((row) => row.post_id as string));
}

export async function myMarks(userId: string, postIds: string[]): Promise<Marks> {
  if (postIds.length === 0) return NO_MARKS;
  const [liked, votes, reposted, saved] = await Promise.all([myLikes(userId, postIds), myVotes(userId, postIds), idsIn("reposts", userId, postIds), idsIn("bookmarks", userId, postIds)]);
  return { liked, votes, reposted, saved };
}

/** Merge a later page's marks into the ones already known. */
export function mergeMarks(a: Marks, b: Marks): Marks {
  return { liked: new Set([...a.liked, ...b.liked]), votes: new Map([...a.votes, ...b.votes]), reposted: new Set([...a.reposted, ...b.reposted]), saved: new Set([...a.saved, ...b.saved]) };
}

/** Repost or undo it, as yourself (RLS: your own row, a visible top-level post). */
export async function setReposted(postId: string, reposted: boolean): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = reposted
    ? await supabase.from("reposts").insert({ user_id: user.id, post_id: postId })
    : await supabase.from("reposts").delete().eq("user_id", user.id).eq("post_id", postId);
  return !error || error.code === "23505";
}

/** Save a post to your bookmarks, or remove it. Bookmarks are private (RLS: owner only). */
export async function setSaved(postId: string, saved: boolean): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = saved
    ? await supabase.from("bookmarks").insert({ user_id: user.id, post_id: postId })
    : await supabase.from("bookmarks").delete().eq("user_id", user.id).eq("post_id", postId);
  return !error || error.code === "23505";
}

/** Your saved posts, newest save first; `before` is the previous page's `next`. */
export async function fetchSaved(before?: string | null, limit = 20): Promise<{ posts: PostView[]; hasMore: boolean; next: string | null } | ApiError> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to see your saved posts.", code: "SIGNED_OUT" };

  let query = supabase.from("bookmarks").select("post_id, created_at").eq("user_id", user.id).order("created_at", { ascending: false });
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query.limit(limit);
  if (error) {
    return error.code === "42P01" || error.code === "PGRST205"
      ? { error: "Saving posts isn't switched on yet.", code: "NOT_CONFIGURED" }
      : { error: "Couldn't load your saved posts." };
  }
  const rows = (data ?? []) as { post_id: string; created_at: string }[];
  if (!rows.length) return { posts: [], hasMore: false, next: null };

  try {
    const response = await fetch(`/api/community/posts?ids=${rows.map((r) => r.post_id).join(",")}`, { cache: "no-store" });
    const body = await response.json();
    if (!body?.success) return { error: body?.error ?? "Couldn't load your saved posts.", code: body?.code };
    // A saved post that was since hidden or deleted drops out; the cursor still moves past it.
    return { posts: body.posts as PostView[], hasMore: rows.length === limit, next: rows[rows.length - 1].created_at };
  } catch {
    return { error: "Couldn't load your saved posts. Check your connection." };
  }
}

export async function setLiked(postId: string, liked: boolean): Promise<boolean> {
  const { error } = liked
    ? await supabase.from("post_likes").insert({ post_id: postId })
    : await supabase.from("post_likes").delete().eq("post_id", postId);
  // 23505: already liked — the end state is what was asked for.
  return !error || error.code === "23505";
}

export async function reportPost(
  postId: string,
  reason: "spam" | "tips" | "abuse" | "scam" | "other"
): Promise<boolean> {
  const { error } = await supabase.from("post_reports").insert({ post_id: postId, reason });
  return !error || error.code === "23505";
}

/**
 * Delete your own post or comment. "removed" when it is gone; "kept" when it
 * was a comment others had answered, which the database keeps as a
 * "[deleted]" placeholder so their replies stay in place; false on failure.
 */
export async function deleteMyPost(postId: string): Promise<"removed" | "kept" | false> {
  const { error, count } = await supabase
    .from("posts")
    .delete({ count: "exact" })
    .eq("id", postId);
  if (error) return false;
  if ((count ?? 0) > 0) {
    // Its photos are now unused: take them down now rather than waiting for the daily cleanup.
    void removePhotos([], true);
    return "removed";
  }
  const { data } = await supabase.from("posts").select("deleted_at").eq("id", postId).maybeSingle();
  return data?.deleted_at ? "kept" : false;
}

/* ------------------------------------------------------------------ */

export type CommunityUser =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "no-profile" }
  | { status: "unavailable" }
  | { status: "ready"; profile: Profile };

/** The viewer's community identity, kept in sync with sign-in/out. */
export function useCommunityUser(): CommunityUser {
  const [user, setUser] = useState<CommunityUser>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await getMyProfile();
      if (cancelled) return;
      setUser(
        result.status === "ok"
          ? { status: "ready", profile: result.profile }
          : result.status === "missing"
            ? { status: "no-profile" }
            : result.status === "signed-out"
              ? { status: "signed-out" }
              : { status: "unavailable" }
      );
    }

    load();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") load();
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  return user;
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
