"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PageHeader, PageShell, secondaryButtonClass } from "@/components/ui/Page";
import type { NewsFeed, NewsItem, NewsRegion, NewsSourceId } from "@/lib/news/types";

/**
 * Market News.
 *
 * India: Upstox (Nifty 50 company news), NSE filings, ET Markets and Business
 * Standard. US: Finnhub market news. Headlines and short summaries only — each
 * item links to its publisher. Everything arrives as plain text from
 * /api/news, and nothing here renders HTML from a feed.
 */

const REGIONS: { id: NewsRegion; label: string }[] = [
  { id: "india", label: "India" },
  { id: "us", label: "US" },
];

const SOURCE_COLORS: Record<NewsSourceId, string> = {
  upstox: "#a855f7",
  nse: "#3b82f6",
  et: "#f97316",
  bs: "#ef4444",
  finnhub: "#22c55e",
};

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; feed: NewsFeed };

function timeAgo(iso: string, now: number) {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

function NewsRow({ item, now }: { item: NewsItem; now: number }) {
  const color = SOURCE_COLORS[item.source];

  return (
    <li className="border-b border-[#1b1b1b] last:border-b-0">
      <article className="group px-4 py-4 transition-colors hover:bg-[#141414] sm:px-5">
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium text-[#cfcfcf]">
            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: color }} />
            {item.sourceName}
          </span>
          {item.kind === "filing" && (
            <span className="rounded border border-[#3b82f6]/40 bg-[#3b82f6]/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-[#93c5fd]">
              Filing
            </span>
          )}
          <span className="text-[#666]">·</span>
          <time dateTime={item.publishedAt} className="text-[#777]" title={new Date(item.publishedAt).toLocaleString()}>
            {timeAgo(item.publishedAt, now)}
          </time>
        </div>

        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="block text-[15px] font-semibold leading-snug text-white decoration-[#22c55e]/60 underline-offset-4 group-hover:underline"
        >
          {item.title}
          <span aria-hidden="true" className="ml-1 text-xs text-[#666]">↗</span>
          <span className="sr-only"> (opens the publisher&apos;s site)</span>
        </a>

        {item.summary && (
          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-[#8f8f8f]">{item.summary}</p>
        )}

        {item.symbols.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {item.symbols.slice(0, 5).map((symbol) => (
              <Link
                key={symbol}
                href={`/stock/${encodeURIComponent(symbol)}`}
                className="rounded-md border border-[#2a2a2a] bg-[#161616] px-2 py-0.5 text-xs font-medium text-[#cfcfcf] transition-colors hover:border-[#22c55e]/50 hover:text-[#4ade80]"
              >
                ${symbol}
              </Link>
            ))}
          </div>
        )}
      </article>
    </li>
  );
}

export default function NewsPage() {
  const [region, setRegion] = useState<NewsRegion>("india");
  const [source, setSource] = useState<NewsSourceId | "all">("all");
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/news?region=${region}`)
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setNow(Date.now());
        setState(
          data?.success && Array.isArray(data.items)
            ? { status: "ready", feed: data as NewsFeed }
            : { status: "error" }
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [region, attempt]);

  function switchRegion(next: NewsRegion) {
    if (next === region) return;
    setRegion(next);
    setSource("all");
    setState({ status: "loading" });
  }

  const items = useMemo(() => {
    if (state.status !== "ready") return [];
    // "Top news" is articles only: NSE posts a filing every few seconds, so
    // filings live under their own chip instead of burying the headlines.
    return source === "all"
      ? state.feed.items.filter((entry) => entry.kind === "news")
      : state.feed.items.filter((entry) => entry.source === source);
  }, [state, source]);

  const down =
    state.status === "ready" ? state.feed.sources.filter((entry) => !entry.ok) : [];

  return (
    <PageShell>
      <PageHeader
        eyebrow="News"
        title="Market news"
        description="Latest headlines and exchange filings, linked to the original publishers."
        actions={
          <div role="tablist" aria-label="Region" className="flex rounded-xl border border-[#2a2a2a] bg-[#111] p-1">
            {REGIONS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={region === entry.id}
                onClick={() => switchRegion(entry.id)}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                  region === entry.id ? "bg-[#22c55e] text-black" : "text-[#999] hover:text-white"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        }
      />

      {/* Source filter */}
      {state.status === "ready" && state.feed.sources.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            {
              id: "all" as const,
              name: state.feed.sources.length > 1 ? "Top news" : "All",
              count: state.feed.items.filter((entry) => entry.kind === "news").length,
              ok: true,
            },
            ...state.feed.sources,
          ].map(
            (entry) => {
              const active = source === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  disabled={!entry.ok}
                  aria-pressed={active}
                  onClick={() => setSource(entry.id)}
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    active
                      ? "border-[#22c55e]/60 bg-[#22c55e]/10 text-white"
                      : "border-[#2a2a2a] text-[#aaa] hover:border-[#3a3a3a] hover:text-white"
                  }`}
                >
                  {entry.name}
                  <span className="ml-1.5 text-xs text-[#777]">{entry.ok ? entry.count : "—"}</span>
                </button>
              );
            }
          )}
        </div>
      )}

      {down.length > 0 && (
        <p className="mb-4 text-xs text-[#777]">
          Not loading right now: {down.map((entry) => entry.name).join(", ")}.
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
        {state.status === "loading" && (
          <ul aria-label="Loading news">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="border-b border-[#1b1b1b] px-5 py-4 last:border-b-0">
                <div className="h-3 w-32 animate-pulse rounded bg-[#1c1c1c]" />
                <div className="mt-2.5 h-4 w-4/5 animate-pulse rounded bg-[#1c1c1c]" />
                <div className="mt-2 h-3 w-3/5 animate-pulse rounded bg-[#191919]" />
              </li>
            ))}
          </ul>
        )}

        {state.status === "error" && (
          <div className="px-6 py-14 text-center">
            <p className="font-semibold">News couldn&apos;t be loaded right now</p>
            <p className="mt-1 text-sm text-[#888]">Our news sources didn&apos;t respond. Please try again.</p>
            <button
              type="button"
              onClick={() => {
                setState({ status: "loading" });
                setAttempt((count) => count + 1);
              }}
              className={`${secondaryButtonClass} mt-4`}
            >
              Try again
            </button>
          </div>
        )}

        {state.status === "ready" && items.length === 0 && (
          <p className="px-6 py-14 text-center text-sm text-[#888]">No headlines from this source in the last week.</p>
        )}

        {state.status === "ready" && items.length > 0 && (
          <ul>
            {items.map((entry) => (
              <NewsRow key={entry.id} item={entry} now={now} />
            ))}
          </ul>
        )}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-[#666]">
        Headlines and summaries belong to their publishers; StockSphere links to the original articles.
        News is for information only and is not investment advice.
      </p>
    </PageShell>
  );
}
