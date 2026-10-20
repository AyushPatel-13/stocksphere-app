"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import PredictionBadge from "@/components/Predictions/Badge";
import { StockAvatar } from "@/components/Markets/StockBits";
import { fetchTrending } from "@/lib/community/client";
import type { TrendingSymbol } from "@/lib/community/types";
import { fetchLeaderboard } from "@/lib/predictions/client";
import { accuracy } from "@/lib/predictions/rules";
import type { LeaderRow } from "@/lib/predictions/service";

/**
 * Home page community highlights: the most-discussed stocks and the top
 * predictors, both from the server (the same data as /trending and
 * /leaderboard). Before community accounts are switched on, each card says
 * so instead of showing invented numbers.
 */

type Load<T> = { status: "loading" } | { status: "off" } | { status: "ready"; items: T[] };

function Card({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#222] bg-[#111] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Link href={href} className="text-sm text-[#4ade80] hover:underline">
          See all →
        </Link>
      </div>
      {children}
    </section>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-[#888]">{children}</p>;
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-[#171717]" />
      ))}
    </div>
  );
}

export default function HomeStats() {
  const [trending, setTrending] = useState<Load<TrendingSymbol>>({ status: "loading" });
  const [leaders, setLeaders] = useState<Load<LeaderRow>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetchTrending().then((items) => {
      if (!cancelled) setTrending(items ? { status: "ready", items: items.slice(0, 5) } : { status: "off" });
    });
    fetchLeaderboard().then((result) => {
      if (!cancelled) setLeaders(Array.isArray(result) ? { status: "ready", items: result.slice(0, 5) } : { status: "off" });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mt-14 grid gap-6 md:grid-cols-2">
      <Card title="🔥 Most discussed" href="/trending">
        {trending.status === "loading" && <Skeleton />}
        {trending.status === "off" && <Note>Discussions are launching soon.</Note>}
        {trending.status === "ready" && trending.items.length === 0 && <Note>No discussions in the last 24 hours.</Note>}
        {trending.status === "ready" && trending.items.length > 0 && (
          <ul className="space-y-1">
            {trending.items.map((entry, index) => (
              <li key={entry.symbol}>
                <Link
                  href={`/stock/${encodeURIComponent(entry.symbol)}`}
                  className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[#161616]"
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
          </ul>
        )}
      </Card>

      <Card title="🏆 Top predictors" href="/leaderboard">
        {leaders.status === "loading" && <Skeleton />}
        {leaders.status === "off" && <Note>Scored predictions are launching soon.</Note>}
        {leaders.status === "ready" && leaders.items.length === 0 && <Note>No scored predictions yet.</Note>}
        {leaders.status === "ready" && leaders.items.length > 0 && (
          <ul className="space-y-1">
            {leaders.items.map((leader, index) => {
              const acc = accuracy(leader.stats);
              return (
                <li key={leader.username}>
                  <Link
                    href={`/profile/${leader.username}`}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[#161616]"
                  >
                    <span className="w-4 text-xs tabular-nums text-[#666]">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{leader.displayName}</span>
                    <PredictionBadge stats={leader.stats} />
                    <span className="text-xs tabular-nums text-[#888]">
                      {acc === null ? "—" : `${Math.round(acc)}%`} · {leader.stats.points} pts
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
