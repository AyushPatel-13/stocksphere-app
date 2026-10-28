"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import PostCard from "@/components/Community/PostCard";
import PredictionCard from "@/components/Predictions/PredictionCard";
import { StatCard, secondaryButtonClass } from "@/components/ui/Page";
import { NO_MARKS, fetchProfilePosts, mergeMarks, myMarks, type CommunityUser, type Marks } from "@/lib/community/client";
import type { PostView } from "@/lib/community/types";
import { fetchPredictions } from "@/lib/predictions/client";
import { accuracy, type PredictionStats } from "@/lib/predictions/rules";
import type { PredictionView } from "@/lib/predictions/service";
import { PROFILE_TAB_LABELS, commentHref, emptyTabText, type ProfileTabId } from "@/lib/profileView";

type PostTab = Exclude<ProfileTabId, "predictions">;
type TabState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; posts: PostView[]; hasMore: boolean; next: string | null; loadingMore?: boolean };

const TABS: ProfileTabId[] = ["posts", "replies", "liked", "reposts", "predictions"];
const PAGE = 20;

/**
 * A member's posts, their posts and replies, what they liked, and their
 * predictions. Tabs switch in place (no navigation); each loads once, on
 * first open, and keeps its place. `added` are posts the viewer just wrote
 * here, shown at the top of their own Posts and Posts & Replies.
 */
export default function ProfileTabs({
  username,
  user,
  own,
  added,
  stats,
}: {
  username: string;
  user: CommunityUser;
  own: boolean;
  added: PostView[];
  stats: PredictionStats;
}) {
  const [tab, setTab] = useState<ProfileTabId>("posts");
  const [tabs, setTabs] = useState<Partial<Record<PostTab, TabState>>>({});
  const [predictions, setPredictions] = useState<PredictionView[] | "error" | null>(null);
  const [marks, setMarks] = useState<Marks>(NO_MARKS);
  const [attempt, setAttempt] = useState(0);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

  const current = tab === "predictions" ? undefined : tabs[tab];

  // Load a posts tab the first time it is opened (or again after "Try again"); not loaded yet shows as loading.
  useEffect(() => {
    if (tab === "predictions" || current) return;
    let cancelled = false;
    fetchProfilePosts({ handle: username, tab, limit: PAGE }).then((result) => {
      if (cancelled) return;
      setTabs((all) => ({
        ...all,
        [tab]: "error" in result ? { status: "error", message: result.error } : { status: "ready", posts: result.posts, hasMore: result.hasMore, next: result.next },
      }));
    });
    return () => {
      cancelled = true;
    };
    // `current` is read only to skip a tab that's already loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, username, attempt]);

  useEffect(() => {
    if (tab !== "predictions" || predictions !== null) return;
    let cancelled = false;
    fetchPredictions({ user: username, limit: 10 }).then((result) => {
      if (!cancelled) setPredictions(Array.isArray(result) ? result : "error");
    });
    return () => {
      cancelled = true;
    };
  }, [tab, username, predictions]);

  // Which of the visible posts the viewer has liked (their Liked tab: all of them).
  const userId = user.status === "ready" ? user.profile.id : null;
  const visible = current?.status === "ready" ? [...added, ...current.posts] : [];
  const ids = visible.map((post) => post.id).join(",");
  useEffect(() => {
    if (!userId || !ids) return;
    let cancelled = false;
    myMarks(userId, ids.split(",")).then((found) => {
      if (!cancelled) setMarks((all) => mergeMarks(all, found));
    });
    return () => {
      cancelled = true;
    };
  }, [userId, ids]);

  async function loadMore(which: PostTab) {
    const state = tabs[which];
    if (state?.status !== "ready" || !state.next || state.loadingMore) return;
    setTabs((all) => ({ ...all, [which]: { ...state, loadingMore: true } }));
    const result = await fetchProfilePosts({ handle: username, tab: which, before: state.next, limit: PAGE });
    setTabs((all) => {
      const now = all[which];
      if (now?.status !== "ready") return all;
      if ("error" in result) return { ...all, [which]: { ...now, loadingMore: false } };
      const seen = new Set(now.posts.map((p) => p.id));
      return { ...all, [which]: { status: "ready", posts: [...now.posts, ...result.posts.filter((p) => !seen.has(p.id))], hasMore: result.hasMore, next: result.next } };
    });
  }

  /** A post or comment deleted from any tab leaves every tab. */
  function remove(id: string) {
    setTabs((all) => {
      const next = { ...all };
      for (const key of Object.keys(next) as PostTab[]) {
        const state = next[key];
        if (state?.status === "ready") next[key] = { ...state, posts: state.posts.filter((p) => p.id !== id) };
      }
      return next;
    });
  }

  // Arrow keys, Home and End move between tabs (the WAI-ARIA tabs pattern).
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.indexOf(tab);
    const next =
      event.key === "ArrowRight" ? TABS[(index + 1) % TABS.length] : event.key === "ArrowLeft" ? TABS[(index - 1 + TABS.length) % TABS.length] : event.key === "Home" ? TABS[0] : event.key === "End" ? TABS[TABS.length - 1] : null;
    if (!next) return;
    event.preventDefault();
    setTab(next);
    buttons.current[next]?.focus();
  }

  const shown =
    current?.status === "ready"
      ? [...(tab === "posts" || tab === "replies" ? added.filter((p) => !current.posts.some((q) => q.id === p.id)) : []), ...current.posts]
      : [];

  return (
    <section className="mt-6">
      <div role="tablist" aria-label="Profile" onKeyDown={onKeyDown} className="-mx-4 flex overflow-x-auto overflow-y-hidden [scrollbar-width:none] border-b border-[#1f1f1f] px-4 sm:mx-0 sm:px-0">
        {TABS.map((id) => {
          const active = id === tab;
          return (
            <button
              key={id}
              ref={(el) => {
                buttons.current[id] = el;
              }}
              type="button"
              role="tab"
              id={`profile-tab-${id}`}
              aria-selected={active}
              aria-controls={`profile-panel-${id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(id)}
              className={`relative shrink-0 px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#22c55e]/60 ${
                active ? "text-white" : "text-[#888] hover:bg-[#111] hover:text-white"
              }`}
            >
              {PROFILE_TAB_LABELS[id]}
              <span aria-hidden="true" className={`absolute inset-x-3 -bottom-px h-[3px] rounded-full transition-colors ${active ? "bg-[#22c55e]" : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`profile-panel-${tab}`} aria-labelledby={`profile-tab-${tab}`} tabIndex={0} className="mt-4 focus-visible:outline-none">
        {tab === "predictions" ? (
          <Predictions predictions={predictions} stats={stats} own={own} username={username} onRetry={() => setPredictions(null)} />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
            {(!current || current.status === "loading") &&
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-3 border-b border-[#1b1b1b] px-5 py-4 last:border-b-0">
                  <div className="h-10 w-10 animate-pulse rounded-full bg-[#1a1a1a]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-40 animate-pulse rounded bg-[#1a1a1a]" />
                    <div className="h-3.5 w-full animate-pulse rounded bg-[#181818]" />
                  </div>
                </div>
              ))}

            {current?.status === "error" && (
              <div className="px-6 py-10 text-center">
                <p className="text-sm text-[#888]">{current.message}</p>
                <button
                  type="button"
                  onClick={() => {
                    setTabs((all) => ({ ...all, [tab]: undefined }));
                    setAttempt((n) => n + 1);
                  }}
                  className={`${secondaryButtonClass} mt-3`}
                >
                  Try again
                </button>
              </div>
            )}

            {current?.status === "ready" && shown.length === 0 && (
              <div className="px-6 py-12 text-center">
                <p className="font-semibold">{emptyTabText(tab, own, username)}</p>
                {own && (tab === "posts" || tab === "replies") && <p className="mt-1 text-sm text-[#888]">Tap + to share your first view.</p>}
                {own && tab === "liked" && (
                  <Link href="/community" className="mt-2 inline-block text-sm text-[#22c55e] hover:underline">
                    Browse the community
                  </Link>
                )}
              </div>
            )}

            {current?.status === "ready" && shown.length > 0 && (
              <ul>
                {shown.map((post) => (
                  <li key={post.id} className={`border-b border-[#1b1b1b] last:border-b-0 ${post.parentId ? "px-4 pt-3 sm:px-5" : ""}`}>
                    {post.parentId && (
                      <Link href={commentHref(post)} className="text-xs text-[#777] hover:text-[#4ade80]">
                        ↳ Replied in a thread · View conversation
                      </Link>
                    )}
                    <PostCard
                      post={post}
                      user={user}
                      liked={marks.liked.has(post.id)}
                      vote={marks.votes.get(post.id) ?? 0}
                      reposted={marks.reposted.has(post.id)}
                      saved={marks.saved.has(post.id)}
                      isReply={Boolean(post.parentId)}
                      onDeleted={remove}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {current?.status === "ready" && current.hasMore && tab !== "predictions" && (
          <div className="mt-4 text-center">
            <button type="button" onClick={() => loadMore(tab)} disabled={current.loadingMore} className={secondaryButtonClass}>
              {current.loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function Predictions({
  predictions,
  stats,
  own,
  username,
  onRetry,
}: {
  predictions: PredictionView[] | "error" | null;
  stats: PredictionStats;
  own: boolean;
  username: string;
  onRetry: () => void;
}) {
  const acc = accuracy(stats);
  const open = Array.isArray(predictions) ? predictions.filter((p) => p.status === "open").length : 0;

  return (
    <>
      {stats.resolved > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Accuracy" value={acc === null ? "—" : `${Math.round(acc)}%`} />
          <StatCard label="Right / scored" value={`${stats.wins}/${stats.resolved}`} />
          <StatCard label="Points" value={stats.points} tone={stats.points > 0 ? "up" : "neutral"} />
          <StatCard label="Open calls" value={open} />
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
        {predictions === null ? (
          <div className="h-24 animate-pulse bg-[#141414]" />
        ) : predictions === "error" ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-[#888]">Predictions couldn&apos;t be loaded right now.</p>
            <button type="button" onClick={onRetry} className={`${secondaryButtonClass} mt-3`}>
              Try again
            </button>
          </div>
        ) : predictions.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-[#888]">
            {emptyTabText("predictions", own, username)}{" "}
            {own && (
              <Link href="/predictions" className="text-[#22c55e] hover:underline">
                Make one
              </Link>
            )}
          </p>
        ) : (
          <ul>
            {predictions.map((prediction) => (
              <li key={prediction.id} className="border-b border-[#1b1b1b] last:border-b-0">
                <PredictionCard prediction={prediction} showUser={false} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
