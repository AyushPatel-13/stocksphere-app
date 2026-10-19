"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import PredictionBadge from "@/components/Predictions/Badge";
import BadgeGuide from "@/components/Predictions/BadgeGuide";
import { EmptyState, PageHeader, PageShell, primaryButtonClass } from "@/components/ui/Page";
import { fetchLeaderboard } from "@/lib/predictions/client";
import { accuracy } from "@/lib/predictions/rules";
import type { LeaderRow } from "@/lib/predictions/service";

/** Members ranked by prediction points, scored against real prices. */

const MEDALS = ["🥇", "🥈", "🥉"];

type State = { status: "loading" } | { status: "not-configured" } | { status: "error" } | { status: "ready"; leaders: LeaderRow[] };

export default function LeaderboardPage() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchLeaderboard().then((result) => {
      if (cancelled) return;
      if (Array.isArray(result)) setState({ status: "ready", leaders: result });
      else setState({ status: result.code === "NOT_CONFIGURED" ? "not-configured" : "error" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Predictions"
        title="Leaderboard"
        description="Members ranked by prediction points. Every call is scored automatically against the real market price."
        actions={
          <Link href="/predictions" className={primaryButtonClass}>
            Make a prediction
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {state.status === "loading" && (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-[#111]" />
              ))}
            </div>
          )}

          {(state.status === "not-configured" || state.status === "error") && (
            <EmptyState
              icon="🏆"
              title={state.status === "not-configured" ? "The leaderboard is launching soon" : "The leaderboard couldn't be loaded"}
              description={
                state.status === "not-configured"
                  ? "Rankings appear once scored predictions are switched on."
                  : "Please try again in a moment."
              }
            />
          )}

          {state.status === "ready" && state.leaders.length === 0 && (
            <EmptyState
              icon="🏆"
              title="No scored predictions yet"
              description="Rankings appear as soon as the first predictions are scored."
              action={<Link href="/predictions" className={primaryButtonClass}>Make a prediction</Link>}
            />
          )}

          {state.status === "ready" && state.leaders.length > 0 && (
            <ol className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
              {state.leaders.map((leader, index) => {
                const acc = accuracy(leader.stats);
                return (
                  <li key={leader.username} className="border-b border-[#1d1d1d] last:border-b-0">
                    <Link
                      href={`/profile/${leader.username}`}
                      className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[#151515] sm:px-5"
                    >
                      <span className="w-7 shrink-0 text-center text-lg font-semibold tabular-nums text-[#888]">
                        {MEDALS[index] ?? index + 1}
                      </span>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#262626] bg-[#151515] text-sm font-semibold text-[#22c55e]">
                        {leader.displayName.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-semibold group-hover:text-[#22c55e]">{leader.displayName}</span>
                          <PredictionBadge stats={leader.stats} showRecordWithoutBadge={false} />
                        </span>
                        <span className="block text-xs text-[#777]">@{leader.username}</span>
                      </span>
                      <span className="hidden text-right text-xs text-[#888] sm:block">
                        <span className="block font-semibold tabular-nums text-white">{acc === null ? "—" : `${Math.round(acc)}%`}</span>
                        {leader.stats.wins}/{leader.stats.resolved} right
                      </span>
                      <span className="w-16 text-right">
                        <span className="block font-semibold tabular-nums text-[#4ade80]">{leader.stats.points}</span>
                        <span className="block text-[11px] text-[#777]">pts</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <aside>
          <BadgeGuide />
        </aside>
      </div>
    </PageShell>
  );
}
