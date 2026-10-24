"use client";

import Link from "next/link";
import { useState } from "react";

import { primaryButtonClass } from "@/components/ui/Page";
import { publishPost, type CommunityUser } from "@/lib/community/client";
import { POST_MAX_LENGTH, type Sentiment } from "@/lib/community/rules";
import type { PostView } from "@/lib/community/types";

/**
 * Write a post (or a reply). The server decides whether it is allowed; this
 * form just says why when it isn't.
 */
export default function Composer({
  user,
  symbol,
  ipoId,
  label,
  parentId,
  placeholder,
  compact = false,
  onPosted,
}: {
  user: CommunityUser;
  symbol?: string;
  /** Post in this IPO's community (Upstox IPO id). */
  ipoId?: string;
  /** Display name for the board's instrument, used in the prompt. */
  label?: string;
  parentId?: string;
  placeholder?: string;
  compact?: boolean;
  onPosted: (post: PostView) => void;
}) {
  const [body, setBody] = useState("");
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  if (user.status === "loading") {
    return <div className={`animate-pulse rounded-2xl bg-[#111] ${compact ? "h-12" : "h-32"}`} />;
  }

  if (user.status === "signed-out" || user.status === "no-profile" || user.status === "unavailable") {
    const href = user.status === "no-profile" ? "/onboarding" : "/login";
    const text =
      user.status === "no-profile"
        ? "Pick your @handle to join the discussion."
        : user.status === "unavailable"
          ? "Posting isn't available right now."
          : compact
            ? "Sign in to reply."
            : "Sign in to share your view.";

    return (
      <div className={`flex items-center justify-between gap-3 rounded-2xl border border-[#222] bg-[#111] ${compact ? "px-3 py-2.5" : "p-4"}`}>
        <span className="text-sm text-[#888]">{text}</span>
        {user.status !== "unavailable" && (
          <Link href={href} className="shrink-0 text-sm font-semibold text-[#22c55e] hover:text-[#4ade80]">
            {user.status === "no-profile" ? "Pick handle" : "Sign in"}
          </Link>
        )}
      </div>
    );
  }

  async function submit() {
    if (!body.trim() || posting) return;
    setPosting(true);
    setError(null);

    const result = await publishPost({ body, sentiment: parentId ? null : sentiment, symbol, ipoId, parentId });

    setPosting(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }

    setBody("");
    setSentiment(null);
    onPosted(result.post);
  }

  const remaining = POST_MAX_LENGTH - body.length;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className={`rounded-2xl border border-[#222] bg-[#111] ${compact ? "p-3" : "p-4"}`}
    >
      <div className="flex gap-3">
        {!compact && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#262626] bg-[#151515] text-sm font-semibold text-[#22c55e]">
            {user.profile.display_name.charAt(0).toUpperCase()}
          </span>
        )}
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          maxLength={POST_MAX_LENGTH}
          rows={compact ? 1 : 3}
          placeholder={
            placeholder ??
            (symbol || (ipoId && label) ? `What's your view on ${label ?? symbol}?` : "Share your view. Tag stocks with $ and the ticker, e.g. $TCS")
          }
          aria-label={parentId ? "Write a reply" : "Write a post"}
          className="min-h-[2.5rem] w-full resize-y bg-transparent text-[15px] leading-relaxed text-white outline-none placeholder:text-[#666]"
        />
      </div>

      <div className={`mt-3 flex flex-wrap items-center gap-2 ${compact ? "" : "border-t border-[#1d1d1d] pt-3"}`}>
        {!parentId && (
          <div role="group" aria-label="Your stance" className="flex gap-1.5">
            {(["bullish", "bearish"] as const).map((value) => {
              const active = sentiment === value;
              const bull = value === "bullish";
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSentiment(active ? null : value)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    active
                      ? bull
                        ? "border-[#22c55e]/60 bg-[#22c55e]/15 text-[#4ade80]"
                        : "border-[#ef4444]/60 bg-[#ef4444]/15 text-[#f87171]"
                      : "border-[#2a2a2a] text-[#999] hover:border-[#3a3a3a] hover:text-white"
                  }`}
                >
                  {bull ? "🐂 Bullish" : "🐻 Bearish"}
                </button>
              );
            })}
          </div>
        )}

        <span className={`ml-auto text-xs tabular-nums ${remaining < 50 ? "text-[#f59e0b]" : "text-[#666]"}`}>
          {remaining}
        </span>
        <button type="submit" disabled={!body.trim() || posting} className={`${primaryButtonClass} !py-1.5`}>
          {posting ? "Posting…" : parentId ? "Reply" : "Post"}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-[#f87171]">
          {error}
        </p>
      )}

      {!compact && (
        <p className="mt-2 text-[11px] text-[#666]">
          Views only — not investment advice. No tips for money, group links or spam.
        </p>
      )}
    </form>
  );
}
