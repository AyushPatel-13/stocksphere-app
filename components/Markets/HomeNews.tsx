"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { NewsItem, NewsRegion } from "@/lib/news/types";

/**
 * The home page's "Latest News": the newest headlines from the same feed as
 * /news (Upstox, NSE filings, ET Markets, Business Standard for India;
 * Finnhub for the US), linked to the original publishers.
 */

type State = { status: "loading" } | { status: "error" } | { status: "ready"; items: NewsItem[]; at: number };

function timeAgo(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export default function HomeNews({ limit = 6 }: { limit?: number }) {
  const [region, setRegion] = useState<NewsRegion>("india");
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/news?region=${region}`)
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setState(data?.success && Array.isArray(data.items) ? { status: "ready", items: data.items.slice(0, limit), at: Date.now() } : { status: "error" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [region, limit]);



  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex gap-1.5" role="tablist" aria-label="News region">
          {(["india", "us"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={region === id}
              onClick={() => {
                if (region === id) return;
                setRegion(id);
                setState({ status: "loading" });
              }}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                region === id ? "border-[#22c55e]/60 bg-[#22c55e]/10 text-white" : "border-[#2a2a2a] text-[#999] hover:text-white"
              }`}
            >
              {id === "india" ? "India" : "US"}
            </button>
          ))}
        </div>
        <Link href="/news" className="text-sm text-[#4ade80] hover:underline">
          All news →
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
        {state.status === "loading" &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border-b border-[#1b1b1b] px-5 py-4 last:border-b-0">
              <div className="h-4 w-3/4 animate-pulse rounded bg-[#1a1a1a]" />
              <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-[#181818]" />
            </div>
          ))}

        {state.status === "error" && (
          <p className="px-5 py-8 text-center text-sm text-[#888]">News couldn&apos;t be loaded right now.</p>
        )}

        {state.status === "ready" && state.items.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-[#888]">No headlines right now.</p>
        )}

        {state.status === "ready" && state.items.length > 0 && (
          <ul>
            {state.items.map((item) => (
              <li key={item.id} className="border-b border-[#1b1b1b] last:border-b-0">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-5 py-3.5 transition-colors hover:bg-[#151515] focus-visible:bg-[#151515] focus-visible:outline-none"
                >
                  <p className="text-[15px] font-medium leading-snug text-white">{item.title}</p>
                  <p className="mt-1 text-xs text-[#888]">
                    {item.sourceName}
                    {item.kind === "filing" && " · filing"} · {timeAgo(item.publishedAt, state.at)}
                    <span className="sr-only"> (opens the publisher&apos;s site)</span>
                  </p>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
