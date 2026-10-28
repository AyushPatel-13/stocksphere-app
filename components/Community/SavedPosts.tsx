"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import PostCard from "@/components/Community/PostCard";
import { PageShell, secondaryButtonClass } from "@/components/ui/Page";
import { NO_MARKS, fetchSaved, mergeMarks, myMarks, useCommunityUser, type Marks } from "@/lib/community/client";
import type { PostView } from "@/lib/community/types";

type State =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "off" }
  | { status: "error"; message: string }
  | { status: "ready"; posts: PostView[]; hasMore: boolean; next: string | null; loadingMore?: boolean };

/**
 * Your bookmarks. They're private: only you can read them (RLS), so this
 * page reads them in your own session and then loads the posts themselves.
 * Unsaving a post here takes it off the list.
 */
export default function SavedPosts() {
  const user = useCommunityUser();
  const [state, setState] = useState<State>({ status: "loading" });
  const [marks, setMarks] = useState<Marks>(NO_MARKS);
  const [attempt, setAttempt] = useState(0);

  const ready = user.status === "ready";
  const signedOut = user.status === "signed-out" || user.status === "no-profile";

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    fetchSaved().then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        setState(result.code === "SIGNED_OUT" ? { status: "signed-out" } : result.code === "NOT_CONFIGURED" ? { status: "off" } : { status: "error", message: result.error });
      } else {
        setState({ status: "ready", ...result });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ready, attempt]);

  const userId = ready ? user.profile.id : null;
  const ids = state.status === "ready" ? state.posts.map((p) => p.id).join(",") : "";
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

  async function loadMore() {
    if (state.status !== "ready" || !state.next || state.loadingMore) return;
    setState({ ...state, loadingMore: true });
    const result = await fetchSaved(state.next);
    setState((now) => {
      if (now.status !== "ready") return now;
      if ("error" in result) return { ...now, loadingMore: false };
      const seen = new Set(now.posts.map((p) => p.id));
      return { status: "ready", posts: [...now.posts, ...result.posts.filter((p) => !seen.has(p.id))], hasMore: result.hasMore, next: result.next };
    });
  }

  const shown: State = signedOut
    ? { status: "signed-out" }
    : user.status === "unavailable"
      ? { status: "error", message: "Accounts aren't available right now." }
      : state;

  return (
    <PageShell>
      <Link href="/community" className="mb-4 inline-block text-sm text-[#888] hover:text-white">
        ← Community
      </Link>
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">Saved posts</h1>
      <p className="mt-1 text-sm text-[#888]">Only you can see what you save.</p>

      <div className="mt-6 overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
        {shown.status === "loading" && <div className="h-32 animate-pulse bg-[#141414]" />}

        {shown.status === "signed-out" && (
          <div className="px-6 py-12 text-center">
            <p className="font-semibold">Sign in to see your saved posts</p>
            <Link href="/login" className={`${secondaryButtonClass} mt-3 inline-block`}>
              Sign in
            </Link>
          </div>
        )}

        {shown.status === "off" && (
          <p className="px-6 py-12 text-center text-sm text-[#888]">Saving posts switches on once its database update is approved.</p>
        )}

        {shown.status === "error" && (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-[#888]">{shown.message}</p>
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

        {shown.status === "ready" && shown.posts.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="font-semibold">You haven&apos;t saved any posts yet</p>
            <p className="mt-1 text-sm text-[#888]">Tap ☆ on a post to keep it here.</p>
          </div>
        )}

        {shown.status === "ready" && shown.posts.length > 0 && (
          <ul>
            {shown.posts.map((post) => (
              <li key={post.id} className="border-b border-[#1b1b1b] last:border-b-0">
                <PostCard
                  post={post}
                  user={user}
                  liked={marks.liked.has(post.id)}
                  vote={marks.votes.get(post.id) ?? 0}
                  reposted={marks.reposted.has(post.id)}
                  saved
                  onDeleted={(id) => setState((now) => (now.status === "ready" ? { ...now, posts: now.posts.filter((p) => p.id !== id) } : now))}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {shown.status === "ready" && shown.hasMore && (
        <div className="mt-4 text-center">
          <button type="button" onClick={loadMore} disabled={shown.loadingMore} className={secondaryButtonClass}>
            {shown.loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </PageShell>
  );
}
