"use client";

import { useEffect, useState } from "react";

import Composer from "@/components/Community/Composer";
import PostCard from "@/components/Community/PostCard";
import { secondaryButtonClass } from "@/components/ui/Page";
import { fetchPosts, myLikes, type CommunityUser } from "@/lib/community/client";
import type { Sentiment } from "@/lib/community/rules";
import type { PostView } from "@/lib/community/types";

type Filter = "all" | Sentiment;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "bullish", label: "🐂 Bullish" },
  { id: "bearish", label: "🐻 Bearish" },
];

const PAGE = 20;

type State =
  | { status: "loading" }
  | { status: "not-configured" }
  | { status: "error" }
  | { status: "ready"; posts: PostView[]; hasMore: boolean };

/**
 * A post box over a stream of posts: one stock's board when `symbol` is set,
 * one IPO's community when `ipoId` is set, otherwise every post on StockSphere.
 */
export default function Feed({
  user,
  symbol,
  ipoId,
  label,
  onPosted,
}: {
  user: CommunityUser;
  symbol?: string;
  /** An Upstox IPO id: that IPO's community (and, once listed, its stock's posts). */
  ipoId?: string;
  /** How the board's instrument is named to people (e.g. "NIFTY 50"). */
  label?: string;
  onPosted?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [state, setState] = useState<State>({ status: "loading" });
  const [liked, setLikedIds] = useState<Set<string>>(new Set());
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    fetchPosts({ symbol, ipo: ipoId, sentiment: filter === "all" ? undefined : filter, limit: PAGE }).then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        setState({ status: result.code === "NOT_CONFIGURED" ? "not-configured" : "error" });
      } else {
        setState({ status: "ready", posts: result.posts, hasMore: result.hasMore });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [symbol, ipoId, filter, attempt]);

  // Which visible posts the viewer has liked.
  const userId = user.status === "ready" ? user.profile.id : null;
  const postIds = state.status === "ready" ? state.posts.map((post) => post.id).join(",") : "";

  useEffect(() => {
    if (!userId || !postIds) return;
    let cancelled = false;
    myLikes(userId, postIds.split(",")).then((ids) => {
      if (!cancelled) setLikedIds(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, postIds]);

  async function loadMore() {
    if (state.status !== "ready" || state.posts.length === 0) return;
    setLoadingMore(true);
    const result = await fetchPosts({
      symbol,
      ipo: ipoId,
      sentiment: filter === "all" ? undefined : filter,
      before: state.posts[state.posts.length - 1].createdAt,
      limit: PAGE,
    });
    setLoadingMore(false);
    if (!("error" in result)) {
      setState({ status: "ready", posts: [...state.posts, ...result.posts], hasMore: result.hasMore });
    }
  }

  if (state.status === "not-configured") {
    return (
      <div className="rounded-2xl border border-dashed border-[#2a2a2a] bg-[#0b0b0b] px-6 py-12 text-center">
        <p className="text-2xl" aria-hidden="true">💬</p>
        <p className="mt-3 font-semibold">Discussions are launching soon</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-[#888]">
          Posting on {symbol || ipoId ? label ?? symbol ?? "this IPO" : "StockSphere"} opens as soon as community accounts are switched on.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Composer
        user={user}
        symbol={symbol}
        ipoId={ipoId}
        label={label}
        onPosted={(post) => {
          // A new post shows at the top of the list it belongs in.
          if (state.status === "ready" && (filter === "all" || post.sentiment === filter)) {
            setState({ ...state, posts: [post, ...state.posts] });
          }
          onPosted?.();
        }}
      />

      <div className="mb-3 mt-5 flex items-center gap-2">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={filter === entry.id}
            onClick={() => {
              if (filter === entry.id) return;
              setFilter(entry.id);
              setState({ status: "loading" });
            }}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
              filter === entry.id
                ? "border-[#22c55e]/60 bg-[#22c55e]/10 text-white"
                : "border-[#2a2a2a] text-[#aaa] hover:border-[#3a3a3a] hover:text-white"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
        {state.status === "loading" &&
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-3 border-b border-[#1b1b1b] px-5 py-4 last:border-b-0">
              <div className="h-10 w-10 animate-pulse rounded-full bg-[#1a1a1a]" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-40 animate-pulse rounded bg-[#1a1a1a]" />
                <div className="h-3.5 w-full animate-pulse rounded bg-[#181818]" />
                <div className="h-3.5 w-2/3 animate-pulse rounded bg-[#181818]" />
              </div>
            </div>
          ))}

        {state.status === "error" && (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-[#888]">Posts couldn&apos;t be loaded right now.</p>
            <button
              type="button"
              onClick={() => {
                setState({ status: "loading" });
                setAttempt((n) => n + 1);
              }}
              className={`${secondaryButtonClass} mt-3`}
            >
              Try again
            </button>
          </div>
        )}

        {state.status === "ready" && state.posts.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="font-semibold">
              {filter === "all" ? "No posts yet" : `No ${filter} posts yet`}
            </p>
            <p className="mt-1 text-sm text-[#888]">
              {symbol || ipoId ? `Be the first to share a view on ${label ?? symbol ?? "this IPO"}.` : "Start the conversation."}
            </p>
          </div>
        )}

        {state.status === "ready" && state.posts.length > 0 && (
          <ul>
            {state.posts.map((post) => (
              <li key={post.id} className="border-b border-[#1b1b1b] last:border-b-0">
                <PostCard
                  post={post}
                  user={user}
                  liked={liked.has(post.id)}
                  boardSymbol={symbol}
                  onDeleted={(id) =>
                    setState({ ...state, posts: state.posts.filter((p) => p.id !== id) })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {state.status === "ready" && state.hasMore && (
        <div className="mt-4 text-center">
          <button type="button" onClick={loadMore} disabled={loadingMore} className={secondaryButtonClass}>
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
