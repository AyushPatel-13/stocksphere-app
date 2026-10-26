"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import PostCard from "@/components/Community/PostCard";
import { PageShell } from "@/components/ui/Page";
import { fetchPost, myLikes, useCommunityUser } from "@/lib/community/client";
import type { PostView } from "@/lib/community/types";

type State = { status: "loading" } | { status: "missing" } | { status: "error"; message: string } | { status: "ready"; post: PostView; highlight?: string };

/**
 * One post with its thread open. Given a comment's id instead, it opens that
 * comment's post at the comment.
 */
export default function PostThread({ id, highlight }: { id: string; highlight?: string }) {
  const user = useCommunityUser();
  const [state, setState] = useState<State>({ status: "loading" });
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const first = await fetchPost(id);
      if (cancelled) return;
      if ("error" in first) {
        setState(first.error === "That post no longer exists." ? { status: "missing" } : { status: "error", message: first.error });
        return;
      }
      if (!first.post.parentId) {
        setState({ status: "ready", post: first.post, highlight });
        return;
      }
      const root = first.post.rootId ? await fetchPost(first.post.rootId) : null;
      if (cancelled) return;
      setState(root && "post" in root ? { status: "ready", post: root.post, highlight: highlight ?? id } : { status: "missing" });
    })();
    return () => {
      cancelled = true;
    };
  }, [id, highlight]);

  const userId = user.status === "ready" ? user.profile.id : null;
  const postId = state.status === "ready" ? state.post.id : null;
  useEffect(() => {
    if (!userId || !postId) return;
    myLikes(userId, [postId]).then((ids) => setLiked(ids.has(postId)));
  }, [userId, postId]);

  return (
    <PageShell>
      <Link href="/community" className="mb-4 inline-block text-sm text-[#888] hover:text-white">
        ← Community
      </Link>

      <div className="overflow-hidden rounded-2xl border border-[#1f1f1f] bg-[#0d0d0d]">
        {state.status === "loading" && <div className="h-40 animate-pulse bg-[#111]" />}
        {state.status === "missing" && (
          <div className="px-5 py-10 text-center">
            <p className="font-semibold text-white">This post isn&apos;t available.</p>
            <p className="mt-1 text-sm text-[#888]">It may have been deleted or hidden by a moderator.</p>
          </div>
        )}
        {state.status === "error" && <p className="px-5 py-10 text-center text-sm text-[#888]">{state.message}</p>}
        {state.status === "ready" && (
          <PostCard
            key={state.post.id}
            post={state.post}
            user={user}
            liked={liked}
            openThread
            highlightComment={state.highlight}
            onDeleted={() => setState({ status: "missing" })}
          />
        )}
      </div>
    </PageShell>
  );
}
