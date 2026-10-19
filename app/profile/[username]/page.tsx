"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import PredictionBadge from "@/components/Predictions/Badge";
import PredictionCard from "@/components/Predictions/PredictionCard";
import { PageShell, StatCard } from "@/components/ui/Page";
import { getProfileByHandle, type Profile } from "@/lib/profiles";
import { fetchPredictions } from "@/lib/predictions/client";
import { accuracy, type PredictionStats } from "@/lib/predictions/rules";
import type { PredictionView } from "@/lib/predictions/service";

/**
 * A member's public page: who they are and their prediction track record —
 * the same record behind the badge shown next to their name in the community.
 */
export default function UserProfilePage() {
  const params = useParams();
  const username = decodeURIComponent(String(params.username ?? "")).toLowerCase();

  // undefined while loading, null when no member has this handle.
  const [member, setMember] = useState<Profile | null | undefined>(undefined);
  const [predictions, setPredictions] = useState<PredictionView[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    getProfileByHandle(username)
      .then((profile) => {
        if (!cancelled) setMember(profile);
      })
      .catch(() => {
        if (!cancelled) setMember(null);
      });

    fetchPredictions({ user: username, limit: 10 }).then((result) => {
      if (!cancelled) setPredictions(Array.isArray(result) ? result : []);
    });

    return () => {
      cancelled = true;
    };
  }, [username]);

  const stats: PredictionStats = predictions?.[0]?.user.stats ?? { resolved: 0, wins: 0, points: 0 };
  const acc = accuracy(stats);
  const open = predictions?.filter((p) => p.status === "open").length ?? 0;

  return (
    <PageShell>
      <header className="mb-8 flex items-center gap-4">
        {member?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- Google avatar host isn't configured for next/image
          <img
            src={member.avatar_url}
            alt=""
            width={64}
            height={64}
            referrerPolicy="no-referrer"
            className="h-16 w-16 shrink-0 rounded-2xl border border-[#262626] object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-[#262626] bg-[#151515] text-2xl font-bold text-[#22c55e]">
            {(member?.display_name || username).charAt(0).toUpperCase() || "?"}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-[28px] font-bold leading-tight tracking-tight">
            <span className="truncate">{member?.display_name || username}</span>
            {member && member.role !== "user" && (
              <span className="rounded-md border border-[#22c55e]/40 bg-[#22c55e]/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#4ade80]">
                {member.role === "admin" ? "Team" : "Mod"}
              </span>
            )}
            <PredictionBadge stats={stats} size="md" showRecordWithoutBadge={false} />
          </h1>
          <p className="mt-1 text-sm text-[#888]">
            {member ? (
              <>
                @{member.username} · Joined{" "}
                {new Date(member.created_at).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
              </>
            ) : member === null ? (
              "Not a registered StockSphere member"
            ) : (
              " "
            )}
          </p>
        </div>
      </header>

      {member?.bio && <p className="-mt-4 mb-8 max-w-xl text-[15px] leading-relaxed text-[#cfcfcf]">{member.bio}</p>}

      <h2 className="mb-3 text-lg font-semibold">Prediction record</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Accuracy" value={acc === null ? "—" : `${Math.round(acc)}%`} />
        <StatCard label="Right / scored" value={`${stats.wins}/${stats.resolved}`} />
        <StatCard label="Points" value={stats.points} tone={stats.points > 0 ? "up" : "neutral"} />
        <StatCard label="Open calls" value={open} />
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Recent predictions</h2>
      <div className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
        {predictions === null ? (
          <div className="h-24 animate-pulse bg-[#141414]" />
        ) : predictions.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-[#888]">
            No predictions yet.{" "}
            <Link href="/predictions" className="text-[#22c55e] hover:underline">
              Make one
            </Link>
          </p>
        ) : (
          <ul>
            {predictions.map((prediction) => (
              <li key={prediction.id} className="border-b border-[#1b1b1b] last:border-b-0">
                <PredictionCard prediction={prediction} showUser={false} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
