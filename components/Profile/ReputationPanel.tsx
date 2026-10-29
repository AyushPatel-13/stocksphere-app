"use client";

import { useEffect, useState } from "react";

import type { Dimension } from "@/lib/reputation/compute";

/**
 * A member's reputation, dimension by dimension with sample sizes. Renders
 * nothing while reputation is switched off or unavailable.
 */
export default function ReputationPanel({ username }: { username: string }) {
  const [dimensions, setDimensions] = useState<Dimension[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/reputation?user=${encodeURIComponent(username)}`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data?.success && Array.isArray(data.dimensions)) setDimensions(data.dimensions);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (!dimensions) return null;
  return (
    <section aria-labelledby="reputation-title" className="mt-6 rounded-2xl border border-[#222] bg-[#111] p-4">
      <h2 id="reputation-title" className="text-sm font-semibold">Reputation</h2>
      <p className="mt-0.5 text-[11px] text-[#666]">Each measure is separate, with its sample size. Likes and followers don&apos;t count.</p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {dimensions.map((d) => (
          <div key={d.key} className="rounded-xl border border-[#1f1f1f] p-3" title={d.detail}>
            <dt className="text-xs text-[#888]">{d.label}</dt>
            <dd className="mt-1 text-sm">
              {d.status === "scored" && (
                <>
                  <span className="text-lg font-semibold tabular-nums">{d.value}%</span> <span className="text-xs text-[#777]">from {d.sample}</span>
                </>
              )}
              {d.status === "not_enough_data" && <span className="text-[#888]">Not enough data ({d.sample} of {d.needed})</span>}
              {d.status === "unavailable" && <span className="text-[#666]">{d.detail}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
