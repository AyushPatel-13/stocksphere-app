import Link from "next/link";
import type { ReactNode } from "react";

import { bondFacts } from "@/lib/bonds/bonds";
import { mentionPath, type StoredMention } from "@/lib/community/mentions";
import { ipoCommunityPath } from "@/lib/community/paths";
import { POST_KIND_LABELS, type PostKind } from "@/lib/community/rules";
import { linkPreviews, tokenize } from "@/lib/community/tokens";
import type { PostView } from "@/lib/community/types";

/**
 * What a post says, as React elements — never HTML. Shared by the post card
 * and the composer's preview, so a preview looks exactly like the post.
 */

const MENTION_STYLE: Record<StoredMention["kind"], string> = {
  instrument: "text-[#4ade80]",
  ipo: "text-[#fbbf24]",
  bond: "text-[#7dd3fc]",
};

function mentionTitle(mention: StoredMention): string {
  if (mention.kind === "ipo") return `${mention.name} (IPO)`;
  if (mention.kind === "bond") return `${mention.name} · ${bondFacts(mention)}`;
  return `${mention.name} · ${mention.symbol}`;
}

/** A tagged span in the text: a stored mention (a link), or a preview's pick (styled, not a link). */
export type BodySpan = { start: number; end: number; kind: StoredMention["kind"]; title: string; href?: string };

export function mentionSpans(mentions: StoredMention[]): BodySpan[] {
  return mentions.map((m) => ({ start: m.start, end: m.end, kind: m.kind, title: mentionTitle(m), href: mentionPath(m, ipoCommunityPath) }));
}

/**
 * A post's text with verified stock/IPO/bond mentions, $CASHTAGS, @handles and
 * links as real links. Mention spans come from stored positions (checked by
 * readMentions on the server); the rest is tokenized, so old posts render
 * exactly as they did. `inert` (the preview) keeps in-site links as plain
 * styled text, so clicking one can't navigate away from a draft.
 */
export function PostBody({ body, mentions = [], spans, inert = false }: { body: string; mentions?: StoredMention[]; spans?: BodySpan[]; inert?: boolean }) {
  const parts: ReactNode[] = [];
  let last = 0;
  (spans ?? mentionSpans(mentions)).forEach((span, m) => {
    if (span.start < last) return;
    if (span.start > last) parts.push(<TextPart key={`t${m}`} text={body.slice(last, span.start)} inert={inert} />);
    const text = body.slice(span.start, span.end);
    const className = `font-semibold ${MENTION_STYLE[span.kind]}`;
    parts.push(
      span.href && !inert ? (
        <Link key={`m${m}`} href={span.href} title={span.title} className={`${className} hover:underline`}>
          {text}
        </Link>
      ) : (
        <span key={`m${m}`} title={span.title} className={className}>
          {text}
        </span>
      )
    );
    last = span.end;
  });
  if (last < body.length) parts.push(<TextPart key="tail" text={body.slice(last)} inert={inert} />);

  return <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[#e5e5e5]">{parts}</p>;
}

function TextPart({ text, inert }: { text: string; inert: boolean }) {
  return (
    <>
      {tokenize(text).map((token, i) => {
        if (token.type === "cashtag") {
          return inert ? (
            <span key={i} className="font-semibold text-[#4ade80]">
              {token.value}
            </span>
          ) : (
            <Link key={i} href={`/stock/${encodeURIComponent(token.symbol)}`} className="font-semibold text-[#4ade80] hover:underline">
              {token.value}
            </Link>
          );
        }
        if (token.type === "mention") {
          return inert ? (
            <span key={i} className="font-medium text-[#60a5fa]">
              {token.value}
            </span>
          ) : (
            <Link key={i} href={`/profile/${token.handle}`} className="font-medium text-[#60a5fa] hover:underline">
              {token.value}
            </Link>
          );
        }
        if (token.type === "link") {
          // External links open in a new tab, so even a preview's are safe to follow.
          return (
            <a key={i} href={token.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="break-all text-[#60a5fa] underline underline-offset-2">
              {token.value}
            </a>
          );
        }
        return <span key={i}>{token.value}</span>;
      })}
    </>
  );
}

const KIND_STYLE: Record<PostKind, string> = {
  analysis: "border-[#38bdf8]/40 text-[#7dd3fc]",
  technical: "border-[#2dd4bf]/40 text-[#5eead4]",
  earnings: "border-[#facc15]/40 text-[#fde047]",
  news: "border-[#fb923c]/40 text-[#fdba74]",
  question: "border-[#a78bfa]/40 text-[#c4b5fd]",
  discussion: "border-[#2a2a2a] text-[#cfcfcf]",
};

export function KindBadge({ kind }: { kind: PostKind }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${KIND_STYLE[kind]}`}>{POST_KIND_LABELS[kind]}</span>;
}

/** A post's headline; a link to the post on its own page when `href` is given. */
export function PostTitle({ title, href }: { title: string; href?: string }) {
  const className = "block break-words text-base font-semibold leading-snug text-white";
  return (
    <h3 className="mb-1">
      {href ? (
        <Link href={href} className={`${className} hover:underline`}>
          {title}
        </Link>
      ) : (
        <span className={className}>{title}</span>
      )}
    </h3>
  );
}

/**
 * Cards for the post's links: the real host and path, from the URL alone.
 * Nothing is fetched (no third-party request, no tracking pixel), and the
 * host can't be disguised by the link's text.
 */
export function LinkCards({ body }: { body: string }) {
  const previews = linkPreviews(body);
  if (!previews.length) return null;
  return (
    <ul aria-label="Links" className="mt-2 grid gap-1.5 sm:grid-cols-2">
      {previews.map((preview) => (
        <li key={preview.href} className="min-w-0">
          <a
            href={preview.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="flex min-w-0 items-center gap-2.5 rounded-xl border border-[#242424] bg-[#141414] px-3 py-2 transition-colors hover:border-[#333] hover:bg-[#171717]"
          >
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1c1c1c] text-sm">
              🔗
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-[#e5e5e5]">{preview.host}</span>
              <span className="block truncate text-xs text-[#777]">{preview.path || "Opens in a new tab"}</span>
            </span>
            <span aria-hidden="true" className="ml-auto shrink-0 text-xs text-[#666]">
              ↗
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * The post a quote post quotes, embedded read-only and linking to its own
 * page. `null` (hidden or gone): says so instead of showing anything.
 */
export function QuotedPost({ post }: { post: PostView | null | undefined }) {
  if (!post) {
    return <div className="mt-2 rounded-xl border border-dashed border-[#2a2a2a] px-3 py-2.5 text-sm text-[#777]">The original post is unavailable.</div>;
  }
  return (
    <Link
      href={`/community/post/${post.id}`}
      aria-label={`Quoted post by @${post.author.username}`}
      className="mt-2 block rounded-xl border border-[#262626] bg-[#0f0f0f] px-3 py-2.5 transition-colors hover:border-[#333]"
    >
      <span className="flex flex-wrap items-center gap-x-1.5 text-xs">
        <span className="font-semibold text-white">{post.author.displayName}</span>
        <span className="text-[#777]">@{post.author.username}</span>
        {post.kind && <KindBadge kind={post.kind} />}
      </span>
      {post.title && <span className="mt-1 block text-sm font-semibold text-white">{post.title}</span>}
      <span className="mt-0.5 line-clamp-4 block whitespace-pre-wrap break-words text-sm text-[#cfcfcf]">{post.body}</span>
    </Link>
  );
}
