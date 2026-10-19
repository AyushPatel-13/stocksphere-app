"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Feed from "@/components/Community/Feed";
import { StockAvatar } from "@/components/Markets/StockBits";
import { PageHeader, PageShell } from "@/components/ui/Page";
import { fetchTrending, useCommunityUser } from "@/lib/community/client";
import type { TrendingSymbol } from "@/lib/community/types";

/**
 * The community floor: every post on StockSphere in one place — views on
 * single stocks (tagged with $CASHTAGS) and on the market as a whole — with
 * the most-discussed stocks of the day alongside. Each stock also has its own
 * board on its stock page.
 */

function Trending({ refresh }: { refresh: number }) {
  const [trending, setTrending] = useState<TrendingSymbol[] | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchTrending().then((result) => {
      if (!cancelled) setTrending(result);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  if (trending === null) return null;

  return (
    <section className="rounded-2xl border border-[#222] bg-[#111]">
      <h2 className="border-b border-[#1d1d1d] px-5 py-3.5 font-semibold">🔥 Trending today</h2>
      {trending === undefined ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-[#161616]" />
          ))}
        </div>
      ) : trending.length === 0 ? (
        <p className="px-5 py-6 text-sm text-[#888]">
          Nothing trending yet. Tag stocks with $TICKER in your posts.
        </p>
      ) : (
        <ol>
          {trending.map((entry, index) => (
            <li key={entry.symbol} className="border-b border-[#1b1b1b] last:border-b-0">
              <Link
                href={`/stock/${encodeURIComponent(entry.symbol)}`}
                className="group flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-[#151515]"
              >
                <span className="w-4 text-xs tabular-nums text-[#666]">{index + 1}</span>
                <StockAvatar symbol={entry.symbol} size={28} />
                <span className="flex-1 font-semibold group-hover:text-[#22c55e]">{entry.symbol}</span>
                <span className="text-xs text-[#888]">
                  {entry.posts} {entry.posts === 1 ? "post" : "posts"}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const RULES = [
  "Share your own view and why you hold it.",
  "No tips for money, “sure-shot targets” or group links.",
  "Tag stocks with $TICKER so others can find your post.",
  "Report spam — moderators review every report.",
];

export default function CommunityPage() {
  const user = useCommunityUser();
  const [refresh, setRefresh] = useState(0);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Community"
        title="What investors are saying"
        description="Views on every stock and on the market as a whole. Each stock also has its own discussion board on its page."
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <Feed user={user} onPosted={() => setRefresh((n) => n + 1)} />
        </div>

        <aside className="space-y-6">
          <Trending refresh={refresh} />

          <section className="rounded-2xl border border-[#222] bg-[#111] p-5">
            <h2 className="font-semibold">Community rules</h2>
            <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-[#9a9a9a]">
              {RULES.map((rule) => (
                <li key={rule} className="flex gap-2">
                  <span aria-hidden="true" className="text-[#22c55e]">•</span>
                  {rule}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-[#666]">
              Posts are members&apos; opinions, not investment advice.
            </p>
          </section>
        </aside>
      </div>
    </PageShell>
  );
}
