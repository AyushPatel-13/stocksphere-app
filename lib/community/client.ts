"use client";

import { useEffect, useState } from "react";

import { getMyProfile, type Profile } from "../profiles";
import { supabase } from "../supabase";
import type { EntitySuggestion } from "./entities";
import type { IpoCommunityPage, PublicCommunity } from "./ipoCommunity";
import { toMentionInputs, type MentionPick } from "./mentionInput";
import type { Sentiment } from "./rules";
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
  before?: string;
  limit?: number;
}): Promise<{ posts: PostView[]; hasMore: boolean } | ApiError> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }

  try {
    const response = await fetch(`/api/community/posts?${query.toString()}`);
    const data = await response.json();
    return data?.success
      ? { posts: data.posts as PostView[], hasMore: Boolean(data.hasMore) }
      : { error: data?.error ?? "Couldn't load posts.", code: data?.code };
  } catch {
    return { error: "Couldn't load posts." };
  }
}

export async function publishPost(input: {
  body: string;
  sentiment?: Sentiment | null;
  symbol?: string;
  ipoId?: string;
  parentId?: string;
  mentions?: MentionPick[];
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

/** Edit your own post: its text and its mentions (sent as a whole). */
export async function editMyPost(input: { id: string; body: string; mentions: MentionPick[] }): Promise<{ post: PostView } | ApiError> {
  const token = await accessToken();
  if (!token) return { error: "Sign in to edit.", code: "SIGNED_OUT" };

  try {
    const response = await fetch("/api/community/posts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: input.id, body: input.body, mentions: toMentionInputs(input.mentions) }),
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

export async function deleteMyPost(postId: string): Promise<boolean> {
  const { error, count } = await supabase
    .from("posts")
    .delete({ count: "exact" })
    .eq("id", postId);
  return !error && (count ?? 0) > 0;
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
