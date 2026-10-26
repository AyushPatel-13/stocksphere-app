"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import Composer from "@/components/Community/Composer";
import PredictionBadge from "@/components/Predictions/Badge";
import {
  deleteMyPost,
  fetchPosts,
  reportPost,
  setLiked,
  timeAgo,
  type CommunityUser,
} from "@/lib/community/client";
import type { StoredMention } from "@/lib/community/mentions";
import { ipoCommunityPath } from "@/lib/community/paths";
import { tokenize } from "@/lib/community/tokens";
import type { IpoStatus, PostContext, PostView } from "@/lib/community/types";

/** Where a stored mention links: the instrument's page, or the IPO's community. */
function mentionHref(mention: StoredMention): string {
  return mention.kind === "instrument" ? mention.href : ipoCommunityPath(mention.ipoId);
}

/**
 * A post's text with verified stock/IPO mentions, $CASHTAGS, @handles and
 * links as real links — never HTML. Mention spans come from stored positions
 * (checked by readMentions on the server); the rest is tokenized as before,
 * so old posts render exactly as they did.
 */
export function PostBody({ body, mentions = [] }: { body: string; mentions?: StoredMention[] }) {
  const parts: ReactNode[] = [];
  let last = 0;
  mentions.forEach((mention, m) => {
    if (mention.start < last) return;
    if (mention.start > last) parts.push(<TextPart key={`t${m}`} text={body.slice(last, mention.start)} />);
    parts.push(
      <Link
        key={`m${m}`}
        href={mentionHref(mention)}
        title={mention.kind === "ipo" ? `${mention.name} (IPO)` : `${mention.name} · ${mention.symbol}`}
        className={`font-semibold hover:underline ${mention.kind === "ipo" ? "text-[#fbbf24]" : "text-[#4ade80]"}`}
      >
        {body.slice(mention.start, mention.end)}
      </Link>
    );
    last = mention.end;
  });
  if (last < body.length) parts.push(<TextPart key="tail" text={body.slice(last)} />);

  return <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[#e5e5e5]">{parts}</p>;
}

function TextPart({ text }: { text: string }) {
  return (
    <>
      {tokenize(text).map((token, i) => {
        if (token.type === "cashtag") {
          return (
            <Link key={i} href={`/stock/${encodeURIComponent(token.symbol)}`} className="font-semibold text-[#4ade80] hover:underline">
              {token.value}
            </Link>
          );
        }
        if (token.type === "mention") {
          return (
            <Link key={i} href={`/profile/${token.handle}`} className="font-medium text-[#60a5fa] hover:underline">
              {token.value}
            </Link>
          );
        }
        if (token.type === "link") {
          return (
            <a key={i} href={token.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-[#60a5fa] underline underline-offset-2">
              {token.value}
            </a>
          );
        }
        return <span key={i}>{token.value}</span>;
      })}
    </>
  );
}

const IPO_STATUS_LABEL: Record<IpoStatus, string> = { upcoming: "Upcoming", open: "Open", closed: "Closed", listed: "Listed" };

const VISIBLE_CONTEXT = 3;

/**
 * What the post is about, from stored relations only: "Discussing IPO: X ·
 * Open", the stocks it tagged. A post with none shows nothing — the text is
 * never read for it.
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
        ) : (
          <li key={`instrument:${item.id}`} className="max-w-full text-xs">
            <Link href={item.href} className="flex min-w-0 items-center gap-1.5 rounded-md border border-[#2a2a2a] bg-[#161616] px-2 py-0.5 text-[#cfcfcf] hover:text-[#4ade80]">
              <span className="font-semibold text-white">{item.symbol}</span>
              <span className="truncate text-[#999]">{item.name}</span>
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
  boardSymbol,
  boardIpoId,
  isReply = false,
  onDeleted,
}: {
  post: PostView;
  user: CommunityUser;
  liked: boolean;
  boardSymbol?: string;
  /** On an IPO's own page its chip would only repeat the page. */
  boardIpoId?: string;
  isReply?: boolean;
  onDeleted: (id: string) => void;
}) {
  // Local copy: an edit replaces it in place.
  const [post, setPost] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [isLiked, setIsLiked] = useState(liked);
  const [likes, setLikes] = useState(post.likeCount);
  const [replyCount, setReplyCount] = useState(post.replyCount);
  const [showReplies, setShowReplies] = useState(false);
  const [replies, setReplies] = useState<PostView[] | null>(null);
  const [menu, setMenu] = useState<"closed" | "open" | "report">("closed");
  const [notice, setNotice] = useState<string | null>(null);

  // The parent learns which posts are liked after the first render; follow it
  // (React's "adjust state when a prop changes" pattern, no effect needed).
  const [likedProp, setLikedProp] = useState(liked);
  if (liked !== likedProp) {
    setLikedProp(liked);
    setIsLiked(liked);
  }

  const signedIn = user.status === "ready";
  const mine = signedIn && user.profile.username === post.author.username;

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

  async function openReplies() {
    const next = !showReplies;
    setShowReplies(next);
    if (next && replies === null) {
      const result = await fetchPosts({ parent: post.id, limit: 50 });
      setReplies("posts" in result ? result.posts : []);
    }
  }

  async function remove() {
    setMenu("closed");
    if (!window.confirm("Delete this post?")) return;
    if (await deleteMyPost(post.id)) onDeleted(post.id);
    else setNotice("Couldn't delete it. Please try again.");
  }

  async function report(reason: (typeof REPORT_REASONS)[number]["id"]) {
    setMenu("closed");
    setNotice((await reportPost(post.id, reason)) ? "Thanks — our moderators will review it." : "Couldn't send the report.");
  }

  // Symbols already shown by a mention or a context chip aren't repeated.
  const covered = new Set((post.mentions ?? []).flatMap((m) => (m.kind === "instrument" ? [m.symbol] : [])));
  const otherSymbols = post.symbols.filter((s) => s !== boardSymbol && !covered.has(s) && !post.body.toUpperCase().includes(`$${s}`));

  return (
    <article className={isReply ? "py-3" : "px-4 py-4 sm:px-5"}>
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
            {post.sentiment && (
              <span
                className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  post.sentiment === "bullish"
                    ? "bg-[#22c55e]/12 text-[#4ade80]"
                    : "bg-[#ef4444]/12 text-[#f87171]"
                }`}
              >
                {post.sentiment === "bullish" ? "🐂 Bullish" : "🐻 Bearish"}
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
                  setPost({ ...updated, likeCount: likes, replyCount });
                  setEditing(false);
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <PostBody body={post.body} mentions={post.mentions} />
            )}
          </div>

          {!isReply && !editing && (
            <PostContextChips
              context={(post.context ?? []).filter((item) =>
                item.kind === "ipo" ? !boardIpoId || item.ipoId !== boardIpoId : !boardSymbol || item.symbol !== boardSymbol
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
                onClick={openReplies}
                aria-expanded={showReplies}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-[#1a1a1a] hover:text-white"
              >
                💬 <span className="tabular-nums">{replyCount}</span>
                <span className="sr-only">replies</span>
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
                    {mine && (
                      <button
                        type="button"
                        onClick={() => {
                          setMenu("closed");
                          setEditing(true);
                        }}
                        className="block w-full px-3 py-2 text-left hover:bg-[#1f1f1f]"
                      >
                        Edit post
                      </button>
                    )}
                    {mine && (
                      <button type="button" onClick={remove} className="block w-full px-3 py-2 text-left text-[#f87171] hover:bg-[#1f1f1f]">
                        Delete post
                      </button>
                    )}
                    {signedIn && !mine && (
                      <button type="button" onClick={() => setMenu("report")} className="block w-full px-3 py-2 text-left hover:bg-[#1f1f1f]">
                        Report post…
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

          {showReplies && !isReply && (
            <div className="mt-2 border-l border-[#262626] pl-3">
              {replies === null ? (
                <div className="h-10 animate-pulse rounded-lg bg-[#151515]" />
              ) : (
                replies.map((reply) => (
                  <PostCard
                    key={reply.id}
                    post={reply}
                    user={user}
                    liked={false}
                    isReply
                    onDeleted={(id) => {
                      setReplies((list) => (list ?? []).filter((r) => r.id !== id));
                      setReplyCount((n) => Math.max(0, n - 1));
                    }}
                  />
                ))
              )}
              <div className="mt-2">
                <Composer
                  user={user}
                  parentId={post.id}
                  compact
                  placeholder={`Reply to @${post.author.username}`}
                  onPosted={(reply) => {
                    setReplies((list) => [...(list ?? []), reply]);
                    setReplyCount((n) => n + 1);
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
