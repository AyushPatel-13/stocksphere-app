"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Feed from "@/components/Community/Feed";
import { fetchSentiment, fetchStockCommunity, useCommunityUser } from "@/lib/community/client";
import { ipoCommunityPath } from "@/lib/community/paths";
import type { PublicCommunity } from "@/lib/community/ipoCommunity";
import type { SentimentSummary } from "@/lib/community/types";

/**
 * One stock's discussion board: the community's bullish/bearish split from
 * real posts in the last week, then the post box and the stock's posts.
 *
 * Replaces the old browser-only BullBearVote and StockDiscussion, whose votes
 * and comments were stored per device and seen by nobody else.
 */

/** `symbol` for a stock board, `ipoId` for an IPO's community. */
export function SentimentMeter({ symbol, ipoId, refresh }: { symbol?: string; ipoId?: string; refresh: number }) {
  const [summary, setSummary] = useState<SentimentSummary | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchSentiment(ipoId ? { ipo: ipoId } : (symbol ?? "")).then((result) => {
      if (!cancelled) setSummary(result);
    });
    return () => {
      cancelled = true;
    };
  }, [symbol, ipoId, refresh]);

  if (summary === undefined) {
    return <div className="h-[74px] animate-pulse rounded-2xl bg-[#111]" />;
  }
  if (summary === null) return null;

  const stances = summary.bullish + summary.bearish;
  const bullPct = stances > 0 ? Math.round((summary.bullish / stances) * 100) : 50;

  return (
    <div className="rounded-2xl border border-[#222] bg-[#111] p-4">
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-semibold text-[#4ade80]">
          🐂 {stances > 0 ? `${bullPct}% Bullish` : "Bullish"}
        </span>
        <span className="text-xs text-[#777]">
          {stances > 0
            ? `${stances} ${stances === 1 ? "view" : "views"} · last ${summary.windowDays} days`
            : "No views yet this week"}
        </span>
        <span className="font-semibold text-[#f87171]">
          {stances > 0 ? `${100 - bullPct}% Bearish` : "Bearish"} 🐻
        </span>
      </div>
      <div
        className="flex h-2.5 overflow-hidden rounded-full bg-[#1f1f1f]"
        role="img"
        aria-label={stances > 0 ? `${bullPct}% bullish, ${100 - bullPct}% bearish` : "No sentiment yet"}
      >
        {stances > 0 && (
          <>
            <div className="bg-[#22c55e]" style={{ width: `${bullPct}%` }} />
            <div className="bg-[#ef4444]" style={{ width: `${100 - bullPct}%` }} />
          </>
        )}
      </div>
    </div>
  );
}

export default function StockBoard({ symbol, label }: { symbol: string; label?: string }) {
  const clean = decodeURIComponent(symbol).trim().toUpperCase();
  // Shown to people: the instrument's name, never "$SYMBOL" — a "$" reads
  // as dollars, which is wrong for an Indian index or stock.
  const name = label || clean;
  const user = useCommunityUser();
  const [refresh, setRefresh] = useState(0);
  const [community, setCommunity] = useState<PublicCommunity | null>(null);

  // A stock that listed from an IPO community keeps that community: its
  // posts are already in this board, and the IPO page stays reachable.
  useEffect(() => {
    let cancelled = false;
    fetchStockCommunity(clean).then((result) => {
      if (!cancelled) setCommunity(result);
    });
    return () => {
      cancelled = true;
    };
  }, [clean]);

  return (
    <section id="community" aria-labelledby="board-title" className="mt-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="board-title" className="text-xl font-semibold tracking-tight">
          {name} discussion
        </h2>
        <span className="text-xs text-[#777]">Community views · not investment advice</span>
      </div>

      {community?.ipoId && (
        <p className="mb-3 text-[13px] text-[#999]">
          This board includes the discussion from {community.name}&apos;s IPO.{" "}
          <Link href={ipoCommunityPath(community.ipoId)} className="font-semibold text-[#22c55e] hover:text-[#4ade80]">
            Open community
          </Link>
        </p>
      )}

      <div className="mb-4">
        <SentimentMeter symbol={clean} refresh={refresh} />
      </div>

      <Feed user={user} symbol={clean} label={name} onPosted={() => setRefresh((n) => n + 1)} />
    </section>
  );
}
