"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { StockAvatar } from "@/components/Markets/StockBits";
import { EmptyState, PageHeader, PageShell, primaryButtonClass } from "@/components/ui/Page";
import { fetchTrending } from "@/lib/community/client";
import type { TrendingSymbol } from "@/lib/community/types";

/**
 * Most-discussed stocks on StockSphere in the last 24 hours, counted from real
 * community posts (each post counts once per stock it tags).
 */
export default function TrendingPage() {
  const [trending, setTrending] = useState<TrendingSymbol[] | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchTrending().then((result) => {
      if (!cancelled) setTrending(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const top = trending?.[0]?.posts ?? 0;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Trending"
        title="Most discussed stocks"
        description="Ranked by how many community posts mentioned each stock in the last 24 hours."
      />

      {trending === undefined && (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-[#111]" />
          ))}
        </div>
      )}

      {trending === null && (
        <EmptyState
          icon="🔥"
          title="Trending is launching with the community"
          description="Once members start posting, the most-discussed stocks of the day appear here."
          action={<Link href="/community" className={primaryButtonClass}>Go to Community</Link>}
        />
      )}

      {trending && trending.length === 0 && (
        <EmptyState
          icon="🔥"
          title="Nothing trending yet today"
          description="Tag stocks with $TICKER in your posts and they'll show up here."
          action={<Link href="/community" className={primaryButtonClass}>Start a discussion</Link>}
        />
      )}

      {trending && trending.length > 0 && (
        <ol className="grid gap-3 sm:grid-cols-2">
          {trending.map((entry, index) => (
            <li key={entry.symbol}>
              <Link
                href={`/stock/${encodeURIComponent(entry.symbol)}`}
                className="group flex items-center gap-4 rounded-2xl border border-[#222] bg-[#111] p-4 transition-colors hover:border-[#2f2f2f] hover:bg-[#141414] sm:p-5"
              >
                <span className="w-6 text-center text-sm font-semibold tabular-nums text-[#666]">{index + 1}</span>
                <StockAvatar symbol={entry.symbol} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold group-hover:text-[#22c55e]">${entry.symbol}</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#1d1d1d]">
                    <div
                      className="h-full rounded-full bg-[#22c55e]/70"
                      style={{ width: `${Math.max((entry.posts / top) * 100, 6)}%` }}
                    />
                  </div>
                </div>
                <span className="shrink-0 text-sm text-[#aaa]">
                  <span className="font-semibold tabular-nums text-white">{entry.posts}</span>{" "}
                  {entry.posts === 1 ? "post" : "posts"}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </PageShell>
  );
}
