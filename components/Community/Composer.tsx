"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import MentionField, { type MentionFieldHandle } from "@/components/Community/MentionField";
import { primaryButtonClass, secondaryButtonClass } from "@/components/ui/Page";
import { editMyPost, publishPost, type CommunityUser } from "@/lib/community/client";
import { bondFacts } from "@/lib/bonds/bonds";
import { MAX_PICKS, livePicks, pickKey, removePick, type MentionPick } from "@/lib/community/mentionInput";
import { POST_MAX_LENGTH, type Sentiment } from "@/lib/community/rules";
import type { PostView } from "@/lib/community/types";

/**
 * Write a post (or a reply), or edit one of yours. The server decides whether
 * it is allowed; this form just says why when it isn't.
 *
 * Stocks, IPOs and bonds are tagged with @ (or the "Tag" button, which
 * starts an @ at the caret). Each pick is a verified reference the server
 * checks again; plain "@word" text without a pick stays plain text. A bond's
 * page passes its bond as `seed`, so a post written there starts out
 * discussing it (remove the tag to post about something else).
 */

const PICK_LABEL: Record<MentionPick["kind"], { text: string; className: string }> = {
  instrument: { text: "Stock", className: "text-[#4ade80]" },
  ipo: { text: "IPO", className: "text-[#fbbf24]" },
  bond: { text: "Bond", className: "text-[#7dd3fc]" },
};

/** A stored post's mentions as picks, for editing. */
export function picksOf(post: PostView): MentionPick[] {
  return (post.mentions ?? []).map((m): MentionPick => {
    const text = post.body.slice(m.start, m.end);
    if (m.kind === "instrument") return { kind: "instrument", id: m.id, type: m.type, text, name: m.name, detail: `${m.symbol} · ${m.exchange}` };
    if (m.kind === "bond") return { kind: "bond", isin: m.isin, text, name: m.name, detail: bondFacts(m) };
    return { kind: "ipo", ipoId: m.ipoId, text, name: m.name, detail: "IPO" };
  });
}

export default function Composer({
  user,
  symbol,
  ipoId,
  seed,
  label,
  parentId,
  placeholder,
  compact = false,
  editing,
  onPosted,
  onCancel,
}: {
  user: CommunityUser;
  symbol?: string;
  /** Post in this IPO's community (Upstox IPO id). */
  ipoId?: string;
  /** Start every new post with this pick already tagged (a bond's page). */
  seed?: MentionPick;
  /** Display name for the board's instrument, used in the prompt. */
  label?: string;
  parentId?: string;
  placeholder?: string;
  compact?: boolean;
  /** Edit this post (yours) instead of writing a new one. */
  editing?: PostView;
  onPosted: (post: PostView) => void;
  onCancel?: () => void;
}) {
  const fresh = () => (seed ? { body: `${seed.text} `, picks: [seed] } : { body: "", picks: [] as MentionPick[] });
  const [body, setBody] = useState(() => editing?.body ?? fresh().body);
  const [picks, setPicks] = useState<MentionPick[]>(() => (editing ? picksOf(editing) : fresh().picks));
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const field = useRef<MentionFieldHandle>(null);

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

  const live = livePicks(body, picks);
  const isEdit = Boolean(editing);
  const topLevel = !parentId && !(editing?.parentId);

  async function submit() {
    if (!body.trim() || posting) return;
    setPosting(true);
    setError(null);

    const result = editing
      ? await editMyPost({ id: editing.id, body, mentions: live })
      : await publishPost({ body, sentiment: parentId ? null : sentiment, symbol, ipoId, parentId, mentions: live });

    setPosting(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }

    if (!editing) {
      const next = fresh();
      setBody(next.body);
      setPicks(next.picks);
      setSentiment(null);
    }
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
        <MentionField
          ref={field}
          value={body}
          onChange={(next) => {
            setBody(next);
            setError(null);
          }}
          picks={picks}
          onPicksChange={setPicks}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            if (e.key === "Escape" && editing) onCancel?.();
          }}
          maxLength={POST_MAX_LENGTH}
          rows={compact ? 1 : 3}
          placeholder={
            placeholder ??
            (symbol || (ipoId && label)
              ? `What's your view on ${label ?? symbol}? Type @ to tag a stock, IPO or bond`
              : "Share your view. Type @ to tag a stock, IPO or bond, e.g. @SBIN or @GOI 2033")
          }
          aria-label={isEdit ? "Edit your post" : parentId ? "Write a reply" : "Write a post"}
          className="min-h-[2.5rem] w-full resize-y bg-transparent text-[15px] leading-relaxed text-white outline-none placeholder:text-[#666]"
        />
      </div>

      {live.length > 0 && (
        <ul aria-label="Tagged" className="mt-2 flex flex-wrap gap-1.5">
          {live.map((pick, index) => (
            <li key={`${pickKey(pick)}:${index}`} title={pick.detail} className="flex max-w-full items-center gap-1 rounded-full border border-[#2a2a2a] bg-[#151515] py-0.5 pl-2.5 pr-1 text-xs">
              <span className={PICK_LABEL[pick.kind].className}>{PICK_LABEL[pick.kind].text}</span>
              <span className="truncate text-[#ddd]">{pick.name}</span>
              <button
                type="button"
                aria-label={`Remove ${pick.name}`}
                onClick={() => {
                  const next = removePick(body, live, index);
                  setBody(next.text);
                  setPicks(next.picks);
                }}
                className="rounded-full px-1.5 text-[#888] hover:bg-[#222] hover:text-white"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={`mt-3 flex flex-wrap items-center gap-2 ${compact ? "" : "border-t border-[#1d1d1d] pt-3"}`}>
        {topLevel && !isEdit && (
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

        {!compact && (
          <button
            type="button"
            onClick={() => field.current?.startMention()}
            disabled={live.length >= MAX_PICKS}
            className="rounded-full border border-[#2a2a2a] px-3 py-1 text-xs font-semibold text-[#999] transition-colors hover:border-[#3a3a3a] hover:text-white disabled:opacity-40"
          >
            ＠ Tag a stock, IPO or bond
          </button>
        )}

        <span className={`ml-auto text-xs tabular-nums ${remaining < 50 ? "text-[#f59e0b]" : "text-[#666]"}`}>
          {remaining}
        </span>
        {isEdit && (
          <button type="button" onClick={onCancel} className={`${secondaryButtonClass} !py-1.5`}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={!body.trim() || posting} className={`${primaryButtonClass} !py-1.5`}>
          {posting ? (isEdit ? "Saving…" : "Posting…") : isEdit ? "Save" : parentId ? "Reply" : "Post"}
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
