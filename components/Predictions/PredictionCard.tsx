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

const STATUS_STYLE: Record<PredictionView["status"], string> = {
  open: "border-[#3b82f6]/40 bg-[#3b82f6]/10 text-[#93c5fd]",
  won: "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#4ade80]",
  lost: "border-[#ef4444]/40 bg-[#ef4444]/10 text-[#f87171]",
  void: "border-[#444] bg-[#1a1a1a] text-[#999]",
};

export default function PredictionCard({ prediction: p, showUser = true }: { prediction: PredictionView; showUser?: boolean }) {
  const unit = p.assetType === "index" ? "points" : "currency";
  const fmt = (value: number | null) => formatValue(value, unit, p.currency);
  const up = p.direction === "up";
  const move = p.exitPrice !== null ? ((p.exitPrice - p.entryPrice) / p.entryPrice) * 100 : null;

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
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg font-bold ${
            up ? "bg-[#22c55e]/12 text-[#4ade80]" : "bg-[#ef4444]/12 text-[#f87171]"
          }`}
          aria-label={up ? "Predicted up" : "Predicted down"}
        >
          {up ? "↑" : "↓"}
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            <Link href={assetHref(p)} className="hover:text-[#22c55e]">
              {p.symbol}
            </Link>{" "}
            <span className="font-normal text-[#aaa]">
              {up ? "up" : "down"} in {horizonOf(p.horizon)?.label}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-[#888]">
            From {fmt(p.entryPrice)}
            {p.targetPrice !== null && <> → target {fmt(p.targetPrice)}</>}
            {" · "}
            {new Date(p.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </p>
        </div>

        <div className="text-right">
          <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[p.status]}`}>
            {p.status === "open" ? "Open" : p.status === "won" ? `Won +${p.points} pts` : p.status === "lost" ? "Missed" : "No move"}
          </span>
          <p className="mt-1 text-xs tabular-nums text-[#888]">
            {p.status === "open"
              ? timeUntil(p.resolvesAt)
              : p.exitPrice !== null && (
                  <>
                    Closed {fmt(p.exitPrice)}
                    {move !== null && (
                      <span className={move >= 0 ? "text-[#4ade80]" : "text-[#f87171]"}>
                        {" "}({move >= 0 ? "+" : ""}{move.toFixed(2)}%)
                      </span>
                    )}
                  </>
                )}
          </p>
        </div>
      </div>

      {p.note && <p className="mt-2 text-sm leading-relaxed text-[#bbb]">“{p.note}”</p>}
    </article>
  );
}
