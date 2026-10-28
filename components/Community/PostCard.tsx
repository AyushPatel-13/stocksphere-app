"use client";

import Link from "next/link";
import { useState } from "react";

import Composer from "@/components/Community/Composer";
import { KindBadge, LinkCards, PostBody, PostTitle, QuotedPost } from "@/components/Community/PostContent";
import Dialog from "@/components/Profile/Dialog";
import PostImages from "@/components/Community/PostImages";
import Thread from "@/components/Community/Thread";
import PredictionBadge from "@/components/Predictions/Badge";
import {
  deleteMyPost,
  reportPost,
  setLiked,
  setReposted,
  setSaved,
  setVote,
  timeAgo,
  type CommunityUser,
} from "@/lib/community/client";
import { bondFacts } from "@/lib/bonds/bonds";
import { formatQuote, type StockQuote } from "@/lib/community/quotes";
import { applyVote, formatScore, nextVote, scoreOf, type Vote, type VoteCounts } from "@/lib/community/votes";
import { commentHref } from "@/lib/profileView";
import type { IpoStatus, PostContext, PostView } from "@/lib/community/types";

const IPO_STATUS_LABEL: Record<IpoStatus, string> = { upcoming: "Upcoming", open: "Open", closed: "Closed", listed: "Listed" };

const VISIBLE_CONTEXT = 3;

/**
 * What the post is about, from stored relations only: "Discussing IPO: X ·
 * Open", the stocks it tagged, "Discussing bond: name — issuer · coupon ·
 * maturity · ISIN" (verified fields only). A post with none shows nothing —
 * the text is never read for it.
 */
export function PostContextChips({ context }: { context: PostContext[] }) {
  const [all, setAll] = useState(false);
  if (context.length === 0) return null;
  const shown = all ? context : context.slice(0, VISIBLE_CONTEXT);

  return (
    <ul aria-label="Discussing" className="mt-2 flex flex-wrap items-center gap-1.5">
      {shown.map((item) =>
        item.kind === "ipo" ? (
          <li key={`ipo:${item.communityId}`} className="flex max-w-full items-center gap-1 text-xs">
            <Link
              href={item.href}
              className="flex min-w-0 items-center gap-1.5 rounded-md border border-[#f59e0b]/30 bg-[#f59e0b]/10 px-2 py-0.5 text-[#fcd34d] hover:border-[#f59e0b]/60"
            >
              <span className="font-semibold">{item.via === "community" ? "Discussing IPO" : "IPO"}</span>
              <span className="truncate text-[#fde68a]">{item.name}</span>
              {item.status && <span className="shrink-0 text-[#d4a72c]">· {IPO_STATUS_LABEL[item.status]}</span>}
            </Link>
            {item.listed && (
              <Link href={item.listed.href} className="shrink-0 rounded-md border border-[#2a2a2a] bg-[#161616] px-2 py-0.5 font-medium text-[#cfcfcf] hover:text-[#4ade80]">
                {item.listed.exchange}: {item.listed.symbol}
              </Link>
            )}
          </li>
        ) : item.kind === "bond" ? (
          <li key={`bond:${item.communityId}`} className="w-full max-w-md text-xs">
            <Link
              href={item.href}
              className="flex min-w-0 flex-col rounded-lg border border-[#38bdf8]/30 bg-[#38bdf8]/[0.07] px-2.5 py-1.5 hover:border-[#38bdf8]/60"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 font-semibold text-[#7dd3fc]">Discussing bond</span>
                <span className="truncate font-medium text-white">{item.name}</span>
              </span>
              <span className="truncate text-[11px] text-[#9fb6c4]">{bondFacts(item)}</span>
            </Link>
          </li>
        ) : (
          <li key={`instrument:${item.id}`} className="max-w-full text-xs">
            <Link
              href={item.href}
              title={item.quote ? formatQuote(item.quote).title : undefined}
              className="flex min-w-0 items-center gap-1.5 rounded-md border border-[#2a2a2a] bg-[#161616] px-2 py-0.5 text-[#cfcfcf] hover:text-[#4ade80]"
            >
              <span className="font-semibold text-white">{item.symbol}</span>
              <span className="truncate text-[#999]">{item.name}</span>
              {item.quote && <QuoteText quote={item.quote} />}
            </Link>
          </li>
        )
      )}
      {context.length > VISIBLE_CONTEXT && (
        <li>
          <button type="button" onClick={() => setAll(!all)} className="rounded-md px-1.5 py-0.5 text-xs text-[#888] hover:text-white">
            {all ? "Show less" : `+${context.length - VISIBLE_CONTEXT} more`}
          </button>
        </li>
      )}
    </ul>
  );
}

function QuoteText({ quote }: { quote: StockQuote }) {
  const view = formatQuote(quote);
  return (
    <span className="flex shrink-0 items-center gap-1 tabular-nums">
      <span className="text-[#ddd]">{view.price}</span>
      {view.change && <span className={view.tone === "up" ? "text-[#4ade80]" : view.tone === "down" ? "text-[#f87171]" : "text-[#999]"}>{view.change}</span>}
    </span>
  );
}

function Avatar({ post, size = 40 }: { post: PostView; size?: number }) {
  return post.author.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- Google avatar host isn't configured for next/image
    <img
      src={post.author.avatarUrl}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      className="shrink-0 rounded-full border border-[#262626] object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full border border-[#262626] bg-[#151515] font-semibold text-[#22c55e]"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {post.author.displayName.charAt(0).toUpperCase()}
    </span>
  );
}

const REPORT_REASONS = [
  { id: "spam", label: "Spam" },
  { id: "tips", label: "Selling tips / pump" },
  { id: "scam", label: "Scam or group promotion" },
  { id: "abuse", label: "Abusive" },
] as const;

export default function PostCard({
  post: initial,
  user,
  liked,
  vote = 0,
  reposted = false,
  saved = false,
  onQuoted,
  boardSymbol,
  boardIpoId,
  boardBondIsin,
  isReply = false,
  onReply,
  replyToHandle,
  highlighted = false,
  openThread = false,
  highlightComment,
  onDeleted,
}: {
  post: PostView;
  user: CommunityUser;
  liked: boolean;
  /** The viewer's vote on this post or comment. */
  vote?: Vote;
  /** Whether the viewer reposted / saved this post. */
  reposted?: boolean;
  saved?: boolean;
  /** A quote post the viewer just wrote from this card, for the list to show. */
  onQuoted?: (quote: PostView) => void;
  boardSymbol?: string;
  /** On an IPO's own page its chip would only repeat the page. */
  boardIpoId?: string;
  /** Likewise on a bond's page (its ISIN). */
  boardBondIsin?: string;
  /** A comment in a thread (compact, no context chips). */
  isReply?: boolean;
  /** Comments: open the reply box under this one. */
  onReply?: () => void;
  /** Comments past the indentation cap: whom this one answers. */
  replyToHandle?: string;
  /** Comments: the one a link pointed at. */
  highlighted?: boolean;
  /** Top-level posts: start with the comments open (the post's own page). */
  openThread?: boolean;
  /** With openThread: the comment to scroll to. */
  highlightComment?: string;
  /** `kept`: a comment others answered, now a "[deleted]" placeholder. */
  onDeleted: (id: string, kept?: boolean) => void;
}) {
  // Local copy: an edit replaces it in place.
  const [post, setPost] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [isLiked, setIsLiked] = useState(liked);
  const [likes, setLikes] = useState(post.likeCount);
  // A post's count is its whole thread (every depth); before the threaded
  // comments migration that is its direct replies.
  const [commentCount, setCommentCount] = useState(post.commentCount ?? post.replyCount);
  const [showReplies, setShowReplies] = useState(openThread);
  const [menu, setMenu] = useState<"closed" | "open" | "report">("closed");
  const [notice, setNotice] = useState<string | null>(null);

  // The parent learns which posts are liked after the first render; follow it
  // (React's "adjust state when a prop changes" pattern, no effect needed).
  const [likedProp, setLikedProp] = useState(liked);
  if (liked !== likedProp) {
    setLikedProp(liked);
    setIsLiked(liked);
  }

  // Votes, the same way: the viewer's vote arrives after the list loads.
  const voting = initial.upCount !== undefined;
  const [myVote, setMyVote] = useState<Vote>(vote);
  const [voteProp, setVoteProp] = useState<Vote>(vote);
  if (vote !== voteProp) {
    setVoteProp(vote);
    setMyVote(vote);
  }
  const [votes, setVotes] = useState<VoteCounts>({ up: initial.upCount ?? 0, down: initial.downCount ?? 0 });
  const [voteBusy, setVoteBusy] = useState(false);

  // Reposts, quotes and saves exist once their migration is applied (the post then has a repost count).
  const sharing = initial.repostCount !== undefined && !isReply;
  const [isReposted, setIsReposted] = useState(reposted);
  const [isSaved, setIsSaved] = useState(saved);
  const [marksProp, setMarksProp] = useState({ reposted, saved });
  if (reposted !== marksProp.reposted || saved !== marksProp.saved) {
    setMarksProp({ reposted, saved });
    setIsReposted(reposted);
    setIsSaved(saved);
  }
  const [repostCount, setRepostCount] = useState(initial.repostCount ?? 0);
  const [repostMenu, setRepostMenu] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);

  const signedIn = user.status === "ready";
  const mine = signedIn && user.profile.username === post.author.username;

  /** The post's (or comment's) own page, shared through the phone's share sheet or copied. */
  async function share(copyOnly = false) {
    setMenu("closed");
    const url = `${window.location.origin}${commentHref(post)}`;
    try {
      if (!copyOnly && navigator.share) {
        await navigator.share({ title: post.title ?? `@${post.author.username} on StockSphere`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNotice("Link copied.");
    } catch (error) {
      if ((error as { name?: string })?.name !== "AbortError") setNotice(url);
    }
  }

  async function toggleRepost() {
    setRepostMenu(false);
    if (!signedIn) {
      setNotice("Sign in to repost.");
      return;
    }
    if (shareBusy) return;
    const next = !isReposted;
    setShareBusy(true);
    setIsReposted(next);
    setRepostCount((n) => Math.max(0, n + (next ? 1 : -1)));
    const ok = await setReposted(post.id, next);
    setShareBusy(false);
    if (!ok) {
      setIsReposted(!next);
      setRepostCount((n) => Math.max(0, n + (next ? -1 : 1)));
      setNotice("Couldn't update your repost. Please try again.");
    } else {
      setNotice(next ? "Reposted to your profile." : null);
    }
  }

  async function toggleSave() {
    if (!signedIn) {
      setNotice("Sign in to save posts.");
      return;
    }
    const next = !isSaved;
    setIsSaved(next);
    if (!(await setSaved(post.id, next))) {
      setIsSaved(!next);
      setNotice("Couldn't update your saved posts. Please try again.");
    }
  }

  async function castVote(clicked: 1 | -1) {
    if (!signedIn) {
      setNotice("Sign in to vote.");
      return;
    }
    if (voteBusy) return;
    const from = myVote;
    const to = nextVote(from, clicked);
    // Shown at once; put back exactly if the database says no.
    setVoteBusy(true);
    setMyVote(to);
    setVotes((c) => applyVote(c, from, to));
    const ok = await setVote(post.id, to);
    setVoteBusy(false);
    if (!ok) {
      setMyVote(from);
      setVotes((c) => applyVote(c, to, from));
      setNotice("Couldn't save your vote. Please try again.");
    }
  }

  async function toggleLike() {
    if (!signedIn) {
      setNotice("Sign in to like posts.");
      return;
    }
    const next = !isLiked;
    setIsLiked(next);
    setLikes((n) => Math.max(0, n + (next ? 1 : -1)));
    if (!(await setLiked(post.id, next))) {
      setIsLiked(!next);
      setLikes((n) => Math.max(0, n + (next ? -1 : 1)));
    }
  }

  async function remove() {
    setMenu("closed");
    if (!window.confirm(isReply ? "Delete this comment?" : "Delete this post and its comments?")) return;
    const result = await deleteMyPost(post.id);
    if (result) onDeleted(post.id, result === "kept");
    else setNotice("Couldn't delete it. Please try again.");
  }

  if (post.deleted) {
    // Kept only so the replies under it keep their place.
    return (
      <article className="py-2.5">
        <div className="flex items-center gap-3 text-sm text-[#666]">
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-[#2a2a2a] text-xs">
            ×
          </span>
          <span className="italic">Comment deleted</span>
          <span className="text-[#444]">·</span>
          <time dateTime={post.createdAt} className="text-[#555]">
            {timeAgo(post.createdAt)}
          </time>
        </div>
      </article>
    );
  }

  async function report(reason: (typeof REPORT_REASONS)[number]["id"]) {
    setMenu("closed");
    setNotice((await reportPost(post.id, reason)) ? "Thanks — our moderators will review it." : "Couldn't send the report.");
  }

  // Symbols already shown by a mention or a context chip aren't repeated.
  const covered = new Set((post.mentions ?? []).flatMap((m) => (m.kind === "instrument" ? [m.symbol] : [])));
  const otherSymbols = post.symbols.filter((s) => s !== boardSymbol && !covered.has(s) && !post.body.toUpperCase().includes(`$${s}`));

  return (
    <article
      className={`${isReply ? "py-2.5" : "px-4 py-4 sm:px-5"} ${
        highlighted ? "-mx-2 rounded-xl bg-[#22c55e]/[0.06] px-2 ring-1 ring-[#22c55e]/40" : ""
      }`}
    >
      <div className="flex gap-3">
        <Link href={`/profile/${post.author.username}`} aria-label={`@${post.author.username}`}>
          <Avatar post={post} size={isReply ? 32 : 40} />
        </Link>

        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <Link href={`/profile/${post.author.username}`} className="font-semibold text-white hover:underline">
              {post.author.displayName}
            </Link>
            {post.author.role !== "user" && (
              <span className="rounded border border-[#22c55e]/40 bg-[#22c55e]/10 px-1 text-[10px] font-semibold uppercase text-[#4ade80]">
                {post.author.role === "admin" ? "Team" : "Mod"}
              </span>
            )}
            <PredictionBadge stats={post.author.stats ?? { resolved: 0, wins: 0, points: 0 }} />
            <span className="text-[#777]">@{post.author.username}</span>
            <span className="text-[#555]">·</span>
            <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString()} className="text-[#777]">
              {timeAgo(post.createdAt)}
            </time>
            {post.editedAt && (
              <span className="text-[#666]" title={`Edited ${new Date(post.editedAt).toLocaleString()}`}>
                · edited
              </span>
            )}
            {replyToHandle && (
              <span className="basis-full text-xs text-[#777] sm:basis-auto">
                ↳ replying to <span className="text-[#60a5fa]">@{replyToHandle}</span>
              </span>
            )}
            {(post.kind || post.sentiment) && (
              <span className="ml-auto flex items-center gap-1.5">
                {post.kind && <KindBadge kind={post.kind} />}
                {post.sentiment && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      post.sentiment === "bullish"
                        ? "bg-[#22c55e]/12 text-[#4ade80]"
                        : "bg-[#ef4444]/12 text-[#f87171]"
                    }`}
                  >
                    {post.sentiment === "bullish" ? "🐂 Bullish" : "🐻 Bearish"}
                  </span>
                )}
              </span>
            )}
          </header>

          <div className="mt-1">
            {editing ? (
              <Composer
                user={user}
                editing={post}
                compact={isReply}
                onPosted={(updated) => {
                  setPost({ ...updated, likeCount: likes, replyCount: post.replyCount, commentCount });
                  setEditing(false);
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <>
                {post.title && <PostTitle title={post.title} href={openThread ? undefined : `/community/post/${post.id}`} />}
                <PostBody body={post.body} mentions={post.mentions} />
                {post.images && post.images.length > 0 && <PostImages images={post.images} author={post.author.username} />}
                {!isReply && <LinkCards body={post.body} />}
                {post.quoteOf !== undefined && post.quoteOf !== null && <QuotedPost post={post.quoted} />}
              </>
            )}
          </div>

          {!isReply && !editing && (
            <PostContextChips
              context={(post.context ?? []).filter((item) =>
                item.kind === "ipo"
                  ? !boardIpoId || item.ipoId !== boardIpoId
                  : item.kind === "bond"
                    ? !boardBondIsin || item.isin !== boardBondIsin
                    : !boardSymbol || item.symbol !== boardSymbol
              )}
            />
          )}

          {otherSymbols.length > 0 && !isReply && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {otherSymbols.map((symbol) => (
                <Link key={symbol} href={`/stock/${encodeURIComponent(symbol)}`} className="rounded-md border border-[#2a2a2a] bg-[#161616] px-2 py-0.5 text-xs font-medium text-[#cfcfcf] hover:text-[#4ade80]">
                  {symbol}
                </Link>
              ))}
            </div>
          )}

          <div className="relative mt-2.5 flex items-center gap-1 text-sm text-[#888]">
            {voting && (
              <div role="group" aria-label="Vote" className="mr-1 flex items-center rounded-lg border border-[#222] bg-[#0f0f0f]">
                <button
                  type="button"
                  onClick={() => castVote(1)}
                  aria-pressed={myVote === 1}
                  aria-label={myVote === 1 ? "Remove upvote" : "Upvote"}
                  className={`rounded-l-lg px-2 py-1 transition-colors hover:bg-[#1a1a1a] ${myVote === 1 ? "text-[#4ade80]" : "hover:text-[#4ade80]"}`}
                >
                  ▲
                </button>
                <span
                  aria-live="polite"
                  title={`${votes.up} up · ${votes.down} down`}
                  className={`min-w-[1.75rem] text-center text-xs font-semibold tabular-nums ${myVote === 1 ? "text-[#4ade80]" : myVote === -1 ? "text-[#f87171]" : "text-[#cfcfcf]"}`}
                >
                  <span className="sr-only">Score </span>
                  {formatScore(scoreOf(votes))}
                </span>
                <button
                  type="button"
                  onClick={() => castVote(-1)}
                  aria-pressed={myVote === -1}
                  aria-label={myVote === -1 ? "Remove downvote" : "Downvote"}
                  className={`rounded-r-lg px-2 py-1 transition-colors hover:bg-[#1a1a1a] ${myVote === -1 ? "text-[#f87171]" : "hover:text-[#f87171]"}`}
                >
                  ▼
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={toggleLike}
              aria-pressed={isLiked}
              aria-label={isLiked ? "Unlike" : "Like"}
              className={`flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-[#1a1a1a] ${isLiked ? "text-[#f87171]" : "hover:text-white"}`}
            >
              {isLiked ? "♥" : "♡"} <span className="tabular-nums">{likes}</span>
            </button>

            {!isReply && (
              <button
                type="button"
                onClick={() => setShowReplies(!showReplies)}
                aria-expanded={showReplies}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-[#1a1a1a] hover:text-white"
              >
                💬 <span className="tabular-nums">{commentCount}</span>
                <span className="sr-only">comments</span>
              </button>
            )}

            {sharing && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => (signedIn ? setRepostMenu(!repostMenu) : setNotice("Sign in to repost."))}
                  aria-expanded={repostMenu}
                  aria-haspopup="menu"
                  aria-label={isReposted ? "Reposted. Repost options" : "Repost or quote"}
                  className={`flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-[#1a1a1a] ${isReposted ? "text-[#4ade80]" : "hover:text-white"}`}
                >
                  <span aria-hidden="true">⟲</span> <span className="tabular-nums">{repostCount}</span>
                </button>
                {repostMenu && (
                  <div role="menu" className="absolute left-0 top-8 z-10 w-44 overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#151515] py-1 text-sm shadow-xl">
                    <button type="button" role="menuitem" onClick={toggleRepost} className="block w-full px-3 py-2 text-left hover:bg-[#1f1f1f]">
                      {isReposted ? "Undo repost" : "Repost"}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setRepostMenu(false);
                        setQuoting(true);
                      }}
                      className="block w-full px-3 py-2 text-left hover:bg-[#1f1f1f]"
                    >
                      Quote post
                    </button>
                  </div>
                )}
              </div>
            )}

            {sharing && (
              <button
                type="button"
                onClick={toggleSave}
                aria-pressed={isSaved}
                aria-label={isSaved ? "Remove from saved" : "Save post"}
                className={`flex items-center rounded-lg px-2 py-1 transition-colors hover:bg-[#1a1a1a] ${isSaved ? "text-[#fbbf24]" : "hover:text-white"}`}
              >
                <span aria-hidden="true">{isSaved ? "★" : "☆"}</span>
              </button>
            )}

            {!isReply && (
              <button
                type="button"
                onClick={() => share()}
                aria-label="Share post"
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-[#1a1a1a] hover:text-white"
              >
                <span aria-hidden="true">↗</span>
                <span className="hidden text-xs font-semibold sm:inline">Share</span>
              </button>
            )}

            {isReply && onReply && (
              <button
                type="button"
                onClick={onReply}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors hover:bg-[#1a1a1a] hover:text-white"
              >
                ↩ Reply
              </button>
            )}

            <button
              type="button"
              onClick={() => setMenu(menu === "closed" ? "open" : "closed")}
              aria-label="More actions"
              aria-expanded={menu !== "closed"}
              className="ml-auto rounded-lg px-2 py-1 transition-colors hover:bg-[#1a1a1a] hover:text-white"
            >
              ⋯
            </button>

            {menu !== "closed" && (
              <div className="absolute right-0 top-8 z-10 w-56 overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#151515] py-1 text-sm shadow-xl">
                {menu === "open" && (
                  <>
                    <button type="button" onClick={() => share(true)} className="block w-full px-3 py-2 text-left hover:bg-[#1f1f1f]">
                      Copy link
                    </button>
                    {mine && (
                      <button
                        type="button"
                        onClick={() => {
                          setMenu("closed");
                          setEditing(true);
                        }}
                        className="block w-full px-3 py-2 text-left hover:bg-[#1f1f1f]"
                      >
                        Edit {isReply ? "comment" : "post"}
                      </button>
                    )}
                    {mine && (
                      <button type="button" onClick={remove} className="block w-full px-3 py-2 text-left text-[#f87171] hover:bg-[#1f1f1f]">
                        Delete {isReply ? "comment" : "post"}
                      </button>
                    )}
                    {signedIn && !mine && (
                      <button type="button" onClick={() => setMenu("report")} className="block w-full px-3 py-2 text-left hover:bg-[#1f1f1f]">
                        Report {isReply ? "comment" : "post"}…
                      </button>
                    )}
                    {!signedIn && <p className="px-3 py-2 text-[#888]">Sign in to report posts.</p>}
                  </>
                )}
                {menu === "report" &&
                  REPORT_REASONS.map((reason) => (
                    <button key={reason.id} type="button" onClick={() => report(reason.id)} className="block w-full px-3 py-2 text-left hover:bg-[#1f1f1f]">
                      {reason.label}
                    </button>
                  ))}
              </div>
            )}
          </div>

          {notice && <p className="mt-1 text-xs text-[#888]">{notice}</p>}

          {quoting && (
            <Dialog title="Quote post" onClose={() => setQuoting(false)} guarded>
              <Composer
                user={user}
                quoting={post}
                autoFocus
                onCancel={() => setQuoting(false)}
                onPosted={(quote) => {
                  setQuoting(false);
                  setNotice("Quote posted.");
                  onQuoted?.(quote);
                }}
              />
            </Dialog>
          )}

          {showReplies && !isReply && (
            <Thread post={post} user={user} highlight={highlightComment} onCountChange={(delta) => setCommentCount((n) => Math.max(0, n + delta))} />
          )}
        </div>
      </div>
    </article>
  );
}
