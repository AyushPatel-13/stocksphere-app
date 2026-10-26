"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import Composer from "@/components/Community/Composer";
import PostCard from "@/components/Community/PostCard";
import { fetchThread, myLikes, type CommunityUser } from "@/lib/community/client";
import { MAX_INDENT, buildThread, descendantCount, mergeComments, pathTo, type ThreadNode } from "@/lib/community/thread";
import type { PostView } from "@/lib/community/types";

/**
 * A post's comments, Reddit-style: every comment and reply has a Reply
 * action that opens one box directly under it ("Replying to @handle"), and
 * the reply is posted to that comment, not the post. Replies are indented
 * along a thread line (click it to collapse that branch); past MAX_INDENT
 * levels the indentation stops and each reply says whom it answers instead.
 *
 * The whole thread loads in one flat request and is nested here
 * (lib/community/thread.ts), so a reload shows every reply under the
 * comment it answered.
 */

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; comments: PostView[]; truncated: boolean };

export default function Thread({
  post,
  user,
  highlight,
  onCountChange,
}: {
  post: PostView;
  user: CommunityUser;
  /** A comment to scroll to (a notification's link). */
  highlight?: string;
  onCountChange: (delta: number) => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  // Only one reply box at a time: the comment it answers.
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetchThread(post.id).then((result) => {
      if (cancelled) return;
      setState("error" in result ? { status: "error", message: result.error } : { status: "ready", ...result });
    });
    return () => {
      cancelled = true;
    };
  }, [post.id, attempt]);

  const userId = user.status === "ready" ? user.profile.id : null;
  const commentIds = state.status === "ready" ? state.comments.map((c) => c.id).join(",") : "";
  useEffect(() => {
    if (!userId || !commentIds) return;
    let cancelled = false;
    myLikes(userId, commentIds.split(",")).then((ids) => {
      if (!cancelled) setLikedIds(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, commentIds]);

  const tree = useMemo(() => (state.status === "ready" ? buildThread(state.comments, post.id) : []), [state, post.id]);

  // A linked comment: scroll to it once it is on the page (its branch is never collapsed on load).
  const found = highlight ? pathTo(tree, highlight).length > 0 : false;
  useEffect(() => {
    if (!highlight || !found) return;
    document.getElementById(`comment-${highlight}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight, found]);

  function add(comment: PostView) {
    setState((s) => (s.status === "ready" ? { ...s, comments: mergeComments(s.comments, [comment]) } : s));
    onCountChange(1);
  }

  function removed(id: string, kept?: boolean) {
    setState((s) => {
      if (s.status !== "ready") return s;
      return {
        ...s,
        comments: kept ? s.comments.map((c) => (c.id === id ? { ...c, deleted: true, body: "", mentions: [] } : c)) : s.comments.filter((c) => c.id !== id),
      };
    });
    if (!kept) onCountChange(-1);
  }

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const handles = useMemo(() => {
    const map = new Map<string, string>();
    if (state.status === "ready") for (const c of state.comments) if (!c.deleted) map.set(c.id, c.author.username);
    return map;
  }, [state]);

  function renderNode(node: ThreadNode): ReactNode {
    const comment = node.post;
    const parentHandle = comment?.parentId ? handles.get(comment.parentId) : undefined;
    const hidden = collapsed.has(node.id);
    const indent = node.depth < MAX_INDENT;

    return (
      <li key={node.id} id={`comment-${node.id}`} className="scroll-mt-24">
        {comment ? (
          <PostCard
            post={comment}
            user={user}
            liked={likedIds.has(comment.id)}
            isReply
            highlighted={comment.id === highlight}
            // Past the indentation cap the line no longer shows whom it answers.
            replyToHandle={node.depth >= MAX_INDENT ? parentHandle : undefined}
            onReply={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
            onDeleted={removed}
          />
        ) : (
          <p className="py-2.5 text-sm italic text-[#666]">This comment isn&apos;t available.</p>
        )}

        {comment && replyTo === comment.id && (
          <div className="mb-2 ml-11">
            <Composer
              user={user}
              parentId={comment.id}
              postId={post.id}
              replyingTo={comment.author.username}
              autoFocus
              compact
              placeholder={`Reply to @${comment.author.username}`}
              onCancel={() => setReplyTo(null)}
              onPosted={(reply) => {
                add(reply);
                setReplyTo(null);
                setCollapsed((current) => {
                  const next = new Set(current);
                  next.delete(comment.id);
                  return next;
                });
              }}
            />
          </div>
        )}

        {node.children.length > 0 &&
          (hidden ? (
            <button
              type="button"
              onClick={() => toggle(node.id)}
              aria-expanded={false}
              className="mb-1 ml-11 rounded-md px-1.5 py-0.5 text-xs font-medium text-[#60a5fa] hover:bg-[#1a1a1a]"
            >
              ⊕ {descendantCount(node)} {descendantCount(node) === 1 ? "reply" : "replies"} hidden
            </button>
          ) : (
            <div className={indent ? "relative ml-3 pl-4 sm:ml-4 sm:pl-5" : ""}>
              {indent && (
                <button
                  type="button"
                  onClick={() => toggle(node.id)}
                  aria-expanded
                  aria-label={`Collapse ${descendantCount(node)} ${descendantCount(node) === 1 ? "reply" : "replies"}`}
                  title="Collapse thread"
                  className="group absolute inset-y-0 left-0 w-4 sm:w-5"
                >
                  <span className="absolute inset-y-1 left-[3px] w-px bg-[#262626] transition-colors group-hover:bg-[#4ade80]/60 sm:left-[5px]" />
                </button>
              )}
              <ul>{node.children.map(renderNode)}</ul>
            </div>
          ))}
      </li>
    );
  }

  return (
    <div className="mt-3 border-t border-[#1b1b1b] pt-3">
      <Composer
        user={user}
        parentId={post.id}
        postId={post.id}
        compact
        placeholder={`Comment on @${post.author.username}'s post`}
        onPosted={add}
      />

      {state.status === "loading" && <div className="mt-3 h-12 animate-pulse rounded-lg bg-[#151515]" />}

      {state.status === "error" && (
        <p className="mt-3 text-sm text-[#888]">
          {state.message}{" "}
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="font-semibold text-[#22c55e] hover:text-[#4ade80]">
            Try again
          </button>
        </p>
      )}

      {state.status === "ready" && tree.length === 0 && <p className="mt-3 text-sm text-[#666]">No comments yet. Start the discussion.</p>}

      {tree.length > 0 && <ul className="mt-1">{tree.map(renderNode)}</ul>}

      {state.status === "ready" && state.truncated && (
        <p className="mt-2 text-xs text-[#777]">This thread is very long; only its first {state.comments.length} comments are shown.</p>
      )}
    </div>
  );
}
