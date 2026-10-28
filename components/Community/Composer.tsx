"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import MentionField, { type MentionFieldHandle } from "@/components/Community/MentionField";
import { KindBadge, LinkCards, PostBody, PostTitle, QuotedPost, type BodySpan } from "@/components/Community/PostContent";
import { primaryButtonClass, secondaryButtonClass } from "@/components/ui/Page";
import { editMyPost, publishPost, type CommunityUser } from "@/lib/community/client";
import { bondFacts } from "@/lib/bonds/bonds";
import { MAX_PICKS, livePicks, pickKey, pickSpans, removePick, type MentionPick } from "@/lib/community/mentionInput";
import { POST_KINDS, POST_KIND_LABELS, POST_MAX_LENGTH, TITLE_MAX_LENGTH, type PostKind, type Sentiment } from "@/lib/community/rules";
import { linkPreviews, normaliseLinkInput } from "@/lib/community/tokens";
import { IMAGE_ACCEPT, MAX_IMAGES } from "@/lib/community/images";
import PhotoDraftGrid from "@/components/Community/PhotoDraftGrid";
import { usePhotoDraft } from "@/components/Community/usePhotoDraft";
import type { PostView } from "@/lib/community/types";

/**
 * Write a post (or a reply), or edit one of yours. The server decides whether
 * it is allowed; this form just says why when it isn't.
 *
 * A post can have an optional title and type (Discussion, Question, …) and
 * stance; replies are text only. Stocks, IPOs and bonds are tagged with @
 * (or the "Tag" button, which starts an @ at the caret). Each pick is a
 * verified reference the server checks again; plain "@word" text without a
 * pick stays plain text. A bond's page passes its bond as `seed`, so a post
 * written there starts out discussing it (remove the tag to post about
 * something else).
 *
 * Preview shows the post exactly as it will look. Leaving with unsaved text
 * (Cancel, Escape, Discard, closing the tab) asks first.
 */

const PICK_LABEL: Record<MentionPick["kind"], { text: string; className: string }> = {
  instrument: { text: "Stock", className: "text-[#4ade80]" },
  ipo: { text: "IPO", className: "text-[#fbbf24]" },
  bond: { text: "Bond", className: "text-[#7dd3fc]" },
};

/** Links a post may carry (the server's rule). */
const MAX_LINKS = 2;

/** A stored post's mentions as picks, for editing. */
export function picksOf(post: PostView): MentionPick[] {
  return (post.mentions ?? []).map((m): MentionPick => {
    const text = post.body.slice(m.start, m.end);
    if (m.kind === "instrument") return { kind: "instrument", id: m.id, type: m.type, text, name: m.name, detail: `${m.symbol} · ${m.exchange}` };
    if (m.kind === "bond") return { kind: "bond", isin: m.isin, text, name: m.name, detail: bondFacts(m) };
    return { kind: "ipo", ipoId: m.ipoId, text, name: m.name, detail: "IPO" };
  });
}

const chip = (active: boolean) =>
  `shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
    active ? "border-[#22c55e]/60 bg-[#22c55e]/15 text-[#4ade80]" : "border-[#2a2a2a] text-[#999] hover:border-[#3a3a3a] hover:text-white"
  }`;

export default function Composer({
  user,
  symbol,
  ipoId,
  seed,
  label,
  parentId,
  postId,
  replyingTo,
  autoFocus = false,
  placeholder,
  compact = false,
  editing,
  quoting,
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
  /** Reply to this post or comment. */
  parentId?: string;
  /** With parentId: the top-level post the reply goes under (the server checks they match). */
  postId?: string;
  /** "Replying to @handle" above the box. */
  replyingTo?: string;
  autoFocus?: boolean;
  placeholder?: string;
  compact?: boolean;
  /** Edit this post (yours) instead of writing a new one. */
  editing?: PostView;
  /** Write a quote post that embeds this post. */
  quoting?: PostView;
  onPosted: (post: PostView) => void;
  onCancel?: () => void;
}) {
  const fresh = () => (seed ? { body: `${seed.text} `, picks: [seed] } : { body: "", picks: [] as MentionPick[] });
  const [body, setBody] = useState(() => editing?.body ?? fresh().body);
  const [picks, setPicks] = useState<MentionPick[]>(() => (editing ? picksOf(editing) : fresh().picks));
  const [title, setTitle] = useState(editing?.title ?? "");
  const [kind, setKind] = useState<PostKind | null>(editing?.kind ?? null);
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [link, setLink] = useState<{ open: boolean; text: string; error: string | null }>({ open: false, text: "", error: null });
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  // State updates are async, so a double click could submit twice before
  // `posting` re-renders; this ref closes that gap.
  const inFlight = useRef(false);
  const field = useRef<MentionFieldHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const isEdit = Boolean(editing);
  const topLevel = !parentId && !editing?.parentId;
  // Titles and types are for posts, written in the full composer.
  const withMeta = topLevel && !compact;
  // Photos go on new posts (not comments, and not added while editing).
  const withPhotos = withMeta && !isEdit && user.status === "ready";
  const photos = usePhotoDraft(withPhotos);
  const dirty = editing
    ? body !== editing.body || title.trim() !== (editing.title ?? "") || kind !== (editing.kind ?? null)
    : body.trim() !== fresh().body.trim() || Boolean(title.trim()) || kind !== null || sentiment !== null || photos.photos.length > 0;

  // Closing or reloading the tab with a draft asks first (the browser's own prompt).
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

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
  const links = linkPreviews(body, MAX_LINKS + 1).length;

  function reset() {
    const next = fresh();
    setBody(next.body);
    setPicks(next.picks);
    setTitle("");
    setKind(null);
    setSentiment(null);
    setPreviewing(false);
    setLink({ open: false, text: "", error: null });
    setConfirmingDiscard(false);
    setError(null);
    photos.clear();
  }

  /** Cancel, Escape or Discard: straight away when nothing would be lost, otherwise after a confirm. */
  function leave() {
    if (dirty) setConfirmingDiscard(true);
    else if (onCancel) onCancel();
    else reset();
  }

  function discard() {
    if (onCancel) {
      setConfirmingDiscard(false);
      photos.clear();
      onCancel();
    } else reset();
  }

  async function submit() {
    if (!body.trim() || inFlight.current) return;
    if (photos.uploading) {
      setError("Wait for your photos to finish uploading.");
      return;
    }
    if (photos.failed) {
      setError("Remove the photos that didn't upload, then post.");
      return;
    }
    inFlight.current = true;
    setPosting(true);
    setError(null);

    const result = editing
      ? await editMyPost({
          id: editing.id,
          body,
          mentions: live,
          // Only what changed is sent, so an edit that leaves them alone never touches them.
          ...(withMeta && title.trim() !== (editing.title ?? "") ? { title: title.trim() } : {}),
          ...(withMeta && kind !== (editing.kind ?? null) ? { kind } : {}),
        })
      : await publishPost({
          body,
          sentiment: topLevel ? sentiment : null,
          symbol,
          ipoId,
          parentId,
          postId,
          mentions: live,
          ...(withMeta && title.trim() ? { title: title.trim() } : {}),
          ...(withMeta && kind ? { kind } : {}),
          ...(quoting ? { quoteOf: quoting.id } : {}),
          ...(photos.ready.length ? { images: photos.ready } : {}),
        });

    inFlight.current = false;
    setPosting(false);
    if ("error" in result) {
      setError(result.error);
      setPreviewing(false);
      return;
    }

    if (!editing) {
      photos.markPosted();
      reset();
    }
    onPosted(result.post);
  }

  function addLink() {
    const checked = normaliseLinkInput(link.text);
    if (!checked.ok) {
      setLink({ ...link, error: checked.reason });
      return;
    }
    setLink({ open: false, text: "", error: null });
    setPreviewing(false);
    field.current?.insertText(checked.href);
  }

  const remaining = POST_MAX_LENGTH - body.length;
  const previewSpans: BodySpan[] = pickSpans(body, picks).map(({ pick, start, end }) => ({ start, end, kind: pick.kind, title: pick.detail }));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      aria-busy={posting}
      onDragOver={(event) => {
        if (!withPhotos || !photos.enabled || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!withPhotos || !photos.enabled) return;
        event.preventDefault();
        setDragging(false);
        void photos.add([...event.dataTransfer.files]);
      }}
      onPaste={(event) => {
        if (!withPhotos || !photos.enabled) return;
        const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
        if (files.length) {
          event.preventDefault();
          void photos.add(files);
        }
      }}
      className={`relative rounded-2xl border bg-[#111] ${dragging ? "border-[#22c55e] ring-2 ring-[#22c55e]/30" : "border-[#222]"} ${compact ? "p-3" : "p-4"}`}
    >
      {dragging && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/70 text-sm font-semibold text-[#4ade80]">
          Drop photos to add them
        </div>
      )}
      {replyingTo && !isEdit && (
        <p className="mb-1.5 text-xs text-[#888]">
          Replying to <span className="font-medium text-[#60a5fa]">@{replyingTo}</span>
        </p>
      )}
      <div className="flex gap-3">
        {!compact && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#262626] bg-[#151515] text-sm font-semibold text-[#22c55e]">
            {user.profile.display_name.charAt(0).toUpperCase()}
          </span>
        )}

        {previewing ? (
          <div aria-label="Preview" className="min-w-0 flex-1 rounded-xl border border-dashed border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2.5">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#666]">
              Preview
              {kind && <KindBadge kind={kind} />}
              {sentiment && topLevel && !isEdit && (
                <span className={`rounded-full px-2 py-0.5 normal-case tracking-normal ${sentiment === "bullish" ? "bg-[#22c55e]/12 text-[#4ade80]" : "bg-[#ef4444]/12 text-[#f87171]"}`}>
                  {sentiment === "bullish" ? "🐂 Bullish" : "🐻 Bearish"}
                </span>
              )}
            </div>
            {withMeta && title.trim() && <PostTitle title={title.replace(/\s+/g, " ").trim()} />}
            <PostBody body={body.trim()} spans={previewSpans} inert />
            {topLevel && <LinkCards body={body} />}
            {quoting && <QuotedPost post={quoting} />}
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            {withMeta && (
              <input
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value.replace(/[\r\n]+/g, " "));
                  setError(null);
                }}
                onKeyDown={(e) => {
                  // Enter moves on to the text rather than submitting a post with no body.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    field.current?.focus();
                  }
                }}
                maxLength={TITLE_MAX_LENGTH}
                placeholder="Title (optional)"
                aria-label="Title (optional)"
                className="mb-1.5 w-full border-b border-[#1d1d1d] bg-transparent pb-1.5 text-base font-semibold text-white outline-none placeholder:font-normal placeholder:text-[#555] focus:border-[#2f2f2f]"
              />
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
                // Escape leaves an edit or a reply box (asking first if there's text to lose).
                if (e.key === "Escape" && onCancel) leave();
              }}
              autoFocus={autoFocus}
              maxLength={POST_MAX_LENGTH}
              rows={compact ? 1 : 3}
              placeholder={
                placeholder ??
                (quoting
                  ? "Add your view on this post. Type @ to tag a stock, IPO or bond"
                  : symbol || (ipoId && label)
                  ? `What's your view on ${label ?? symbol}? Type @ to tag a stock, IPO or bond`
                  : "Share your view. Type @ to tag a stock, IPO or bond, e.g. @SBIN or @GOI 2033")
              }
              aria-label={isEdit ? "Edit your post" : parentId ? "Write a reply" : "Write a post"}
              className="min-h-[2.5rem] w-full resize-y bg-transparent text-[15px] leading-relaxed text-white outline-none placeholder:text-[#666]"
            />
          </div>
        )}
      </div>

      {photos.photos.length > 0 && (
        <PhotoDraftGrid photos={photos.photos} readOnly={previewing} onRemove={photos.remove} onAlt={photos.setAlt} />
      )}
      {photos.notice && (
        <p role="status" className="mt-2 text-xs text-[#f59e0b]">
          {photos.notice}
        </p>
      )}

      {quoting && !previewing && (
        <div aria-label="Quoting" className="pointer-events-none">
          <QuotedPost post={quoting} />
        </div>
      )}

      {live.length > 0 && !previewing && (
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

      {link.open && !previewing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="url"
            inputMode="url"
            autoFocus
            value={link.text}
            onChange={(e) => setLink({ ...link, text: e.target.value, error: null })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLink();
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                setLink({ open: false, text: "", error: null });
              }
            }}
            placeholder="https://…"
            aria-label="Link to add"
            aria-invalid={Boolean(link.error)}
            className="min-w-0 flex-1 rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-1.5 text-sm text-white outline-none placeholder:text-[#555] focus:border-[#3a3a3a]"
          />
          <button type="button" onClick={addLink} className={`${secondaryButtonClass} !py-1.5`}>
            Add
          </button>
          <button type="button" onClick={() => setLink({ open: false, text: "", error: null })} className="text-xs text-[#888] hover:text-white">
            Close
          </button>
          {link.error && (
            <p role="alert" className="basis-full text-xs text-[#f87171]">
              {link.error}
            </p>
          )}
        </div>
      )}

      {withMeta && !previewing && (
        <div role="group" aria-label="Post type (optional)" className="-mx-1 mt-3 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
          <span className="shrink-0 text-xs text-[#666]">Type</span>
          {POST_KINDS.map((value) => (
            <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(kind === value ? null : value)} className={chip(kind === value)}>
              {POST_KIND_LABELS[value]}
            </button>
          ))}
        </div>
      )}

      <div className={`mt-3 flex flex-wrap items-center gap-2 ${compact ? "" : "border-t border-[#1d1d1d] pt-3"}`}>
        {topLevel && !isEdit && !previewing && (
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

        {!compact && !previewing && (
          <>
            <button
              type="button"
              onClick={() => field.current?.startMention()}
              disabled={live.length >= MAX_PICKS}
              className="rounded-full border border-[#2a2a2a] px-3 py-1 text-xs font-semibold text-[#999] transition-colors hover:border-[#3a3a3a] hover:text-white disabled:opacity-40"
            >
              ＠ Tag a stock, IPO or bond
            </button>
            <button
              type="button"
              onClick={() => setLink({ open: !link.open, text: "", error: null })}
              disabled={links >= MAX_LINKS}
              title={links >= MAX_LINKS ? `A post can have up to ${MAX_LINKS} links` : undefined}
              aria-expanded={link.open}
              className="rounded-full border border-[#2a2a2a] px-3 py-1 text-xs font-semibold text-[#999] transition-colors hover:border-[#3a3a3a] hover:text-white disabled:opacity-40"
            >
              🔗 Link
            </button>
            {withPhotos && (
              <>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={!photos.enabled || photos.photos.length >= MAX_IMAGES}
                  title={
                    !photos.enabled
                      ? "Photo uploads switch on once their storage is approved"
                      : photos.photos.length >= MAX_IMAGES
                        ? `A post can have up to ${MAX_IMAGES} photos`
                        : "Add photos (JPG, PNG or WebP), or drag them here"
                  }
                  className="rounded-full border border-[#2a2a2a] px-3 py-1 text-xs font-semibold text-[#999] transition-colors hover:border-[#3a3a3a] hover:text-white disabled:opacity-40"
                >
                  <span aria-hidden="true">📷</span> Photo
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept={IMAGE_ACCEPT}
                  multiple
                  className="hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={(event) => {
                    void photos.add([...(event.target.files ?? [])]);
                    event.target.value = "";
                  }}
                />
              </>
            )}
          </>
        )}

        <span className={`ml-auto text-xs tabular-nums ${remaining < 50 ? "text-[#f59e0b]" : "text-[#666]"}`}>{remaining}</span>
        {!compact && (
          <button
            type="button"
            onClick={() => setPreviewing(!previewing)}
            disabled={!body.trim()}
            aria-pressed={previewing}
            className={`${secondaryButtonClass} !py-1.5`}
          >
            {previewing ? "Edit" : "Preview"}
          </button>
        )}
        {(isEdit || onCancel || dirty) && (
          <button type="button" onClick={leave} disabled={posting} className={`${secondaryButtonClass} !py-1.5`}>
            {isEdit || onCancel ? "Cancel" : "Discard"}
          </button>
        )}
        <button type="submit" disabled={!body.trim() || posting || photos.uploading} className={`${primaryButtonClass} !py-1.5`}>
          {posting ? (isEdit ? "Saving…" : "Posting…") : isEdit ? "Save" : parentId ? "Reply" : "Post"}
        </button>
      </div>

      {confirmingDiscard && (
        <div role="alertdialog" aria-label="Discard draft?" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-[#3a2a12] bg-[#1a1408] px-3 py-2 text-sm">
          <span className="text-[#fbbf24]">{isEdit ? "Discard your changes?" : "Discard this draft?"}</span>
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={() => setConfirmingDiscard(false)} className={`${secondaryButtonClass} !py-1`}>
              Keep editing
            </button>
            <button type="button" onClick={discard} className="rounded-lg bg-[#ef4444]/15 px-3 py-1 text-sm font-semibold text-[#f87171] hover:bg-[#ef4444]/25">
              Discard
            </button>
          </span>
        </div>
      )}

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
