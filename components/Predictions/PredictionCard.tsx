"use client";

import Link from "next/link";

import PredictionBadge from "@/components/Predictions/Badge";
import { formatValue } from "@/lib/charts/format";
import { timeUntil } from "@/lib/predictions/client";
import { horizonOf } from "@/lib/predictions/rules";
import type { PredictionView } from "@/lib/predictions/service";

function assetHref(p: PredictionView): string {
  return p.assetType === "stock"
    ? `/stock/${encodeURIComponent(p.symbol)}`
    : `/asset/${p.assetType}/${encodeURIComponent(p.symbol)}`;
}

const STATUS: Record<PredictionView["status"], { label: string; style: string }> = {
  open: { label: "Open", style: "border-[#3b82f6]/40 bg-[#3b82f6]/10 text-[#93c5fd]" },
  correct: { label: "Correct", style: "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#4ade80]" },
  incorrect: { label: "Incorrect", style: "border-[#ef4444]/40 bg-[#ef4444]/10 text-[#f87171]" },
  flat: { label: "Flat", style: "border-[#444] bg-[#1a1a1a] text-[#bbb]" },
  void: { label: "Void", style: "border-[#444] bg-[#1a1a1a] text-[#999]" },
  review: { label: "Under review", style: "border-[#eab308]/40 bg-[#eab308]/10 text-[#facc15]" },
};

const DIRECTION = {
  up: { icon: "↑", word: "up", label: "Predicted up", style: "bg-[#22c55e]/12 text-[#4ade80]" },
  down: { icon: "↓", word: "down", label: "Predicted down", style: "bg-[#ef4444]/12 text-[#f87171]" },
  sideways: { icon: "↔", word: "sideways", label: "Predicted sideways", style: "bg-[#eab308]/12 text-[#facc15]" },
} as const;

export default function PredictionCard({ prediction: p, showUser = true }: { prediction: PredictionView; showUser?: boolean }) {
  const unit = p.assetType === "index" ? "points" : "currency";
  const fmt = (value: number | null) => formatValue(value, unit, p.currency);
  const direction = DIRECTION[p.direction] ?? DIRECTION.up;
  const status = STATUS[p.status] ?? STATUS.open;

  return (
    <article className="px-4 py-4 sm:px-5">
      {showUser && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/profile/${p.user.username}`} className="font-semibold hover:underline">
            {p.user.displayName}
          </Link>
          <PredictionBadge stats={p.user.stats} />
          <span className="text-[#777]">@{p.user.username}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg font-bold ${direction.style}`}
          aria-label={direction.label}
        >
          {direction.icon}
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            <Link href={assetHref(p)} className="hover:text-[#22c55e]">
              {p.symbol}
            </Link>{" "}
            <span className="font-normal text-[#aaa]">
              {direction.word} in {horizonOf(p.horizon)?.label}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-[#888]">
            From {fmt(p.entryPrice)}
            {p.referenceMode === "from_close" && " (last close)"}
            {p.targetPrice !== null && <> → target {fmt(p.targetPrice)}</>}
            {p.direction === "sideways" && <> · within ±{p.bandPct}%</>}
            {" · "}
            {new Date(p.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </p>
        </div>

        <div className="text-right">
          <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${status.style}`}>
            {status.label}
          </span>
          {p.status === "open" && (
            <p className="mt-1 text-xs tabular-nums text-[#888]">{timeUntil(p.estimatedExpiryAt)}</p>
          )}
          {p.status !== "open" && p.result && (
            <p className="mt-1 text-xs tabular-nums text-[#888]">
              {p.result.exitPrice !== null && <>Closed {fmt(p.result.exitPrice)} </>}
              {p.result.movePct !== null && (
                <span className={p.result.movePct >= 0 ? "text-[#4ade80]" : "text-[#f87171]"}>
                  ({p.result.movePct >= 0 ? "+" : ""}
                  {p.result.movePct.toFixed(2)}%)
                </span>
              )}
              {(p.status === "correct" || p.status === "incorrect") && (
                <span className={`ml-1 font-semibold ${p.result.points >= 0 ? "text-[#4ade80]" : "text-[#f87171]"}`}>
                  {p.result.points >= 0 ? "+" : ""}
                  {p.result.points} pts
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      {p.note && <p className="mt-2 text-sm leading-relaxed text-[#bbb]">“{p.note}”</p>}
    </article>
  );
}
