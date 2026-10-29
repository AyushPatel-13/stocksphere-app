import Link from "next/link";

import type { Stance, ThesisStatus, ThesisView } from "@/lib/theses/service";

export const STANCE_LABEL: Record<Stance, string> = { bullish: "Bullish", bearish: "Bearish", neutral: "Neutral" };
const STANCE_CLASS: Record<Stance, string> = {
  bullish: "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#4ade80]",
  bearish: "border-[#ef4444]/40 bg-[#ef4444]/10 text-[#f87171]",
  neutral: "border-[#3a3a3a] bg-[#1a1a1a] text-[#bbb]",
};
const STATUS_LABEL: Record<ThesisStatus, string> = { draft: "Draft", published: "Published", closed: "Closed" };

export function StanceBadge({ stance }: { stance: Stance }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STANCE_CLASS[stance]}`}>{STANCE_LABEL[stance]}</span>;
}

export function StatusBadge({ status }: { status: ThesisStatus }) {
  return <span className="rounded-full border border-[#2a2a2a] px-2 py-0.5 text-[11px] text-[#aaa]">{STATUS_LABEL[status]}</span>;
}

export function formatDate(iso: string): string {
  const day = iso.length === 10 ? `${iso}T12:00:00Z` : iso;
  return new Date(day).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function money(value: number, currency: string | null): string {
  const symbol = currency === "INR" ? "₹" : currency === "USD" ? "$" : "";
  return `${symbol}${value.toLocaleString(currency === "INR" ? "en-IN" : "en-US", { maximumFractionDigits: 2 })}`;
}

export function stockHref(thesis: Pick<ThesisView, "symbol" | "exchange">): string {
  return `/stock/${encodeURIComponent(thesis.exchange === "BSE" ? `${thesis.symbol}.BO` : thesis.symbol)}`;
}

export function ThesisCard({ thesis, showSymbol = true }: { thesis: ThesisView; showSymbol?: boolean }) {
  const latest = thesis.latest;
  return (
    <li className="rounded-xl border border-[#222] bg-[#111] transition-colors hover:border-[#333]">
      <Link href={`/theses/${thesis.id}`} className="block rounded-xl p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/50">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#888]">
          {showSymbol && <span className="font-semibold text-white">{thesis.symbol}</span>}
          {latest && <StanceBadge stance={latest.stance} />}
          {thesis.status !== "published" && <StatusBadge status={thesis.status} />}
          <span>@{thesis.author.username}</span>
          {latest && <span className="ml-auto">Target {formatDate(latest.targetDate)}</span>}
        </div>
        <p className="mt-2 font-semibold leading-snug">{latest?.title ?? "Untitled"}</p>
        {latest && <p className="mt-1 line-clamp-2 text-sm text-[#999]">{latest.summary}</p>}
        <p className="mt-2 text-[11px] text-[#666]">
          {thesis.publishedAt ? `Published ${formatDate(thesis.publishedAt)}` : `Started ${formatDate(thesis.createdAt)}`}
          {thesis.reference && ` · reference ${money(thesis.reference.price, thesis.currency)}`}
          {thesis.currentVersion > 1 && ` · v${thesis.currentVersion}`}
        </p>
      </Link>
    </li>
  );
}

export const NOT_ADVICE = "A member's opinion, not investment advice. Do your own research.";
