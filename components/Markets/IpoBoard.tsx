"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { EmptyState, PageHeader, PageShell, StatCard } from "@/components/ui/Page";
import { ipoCommunityPath } from "@/lib/community/paths";
import { DEMAND_BANDS, DEMAND_DEFINITION, type DemandLevel, type IpoSection } from "@/lib/services/ipoMetrics";
import type { GmpStatus, IpoBoardData, IpoNewsData, IpoNewsItem, IpoRow, SourceStatus } from "@/lib/services/ipo";

/**
 * The IPO page: Open, Upcoming and Closed sections, sorted by subscription
 * dates in Indian time. Data:
 *   /api/ipo        Upstox IPO API — calendar, details, subscription, listing
 *   /api/ipo/news   IPO headlines and per-issue matches
 * Every figure carries its source and fetch time; anything missing shows as
 * "—" with the reason, never a placeholder value.
 */

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

async function getJson<T>(url: string): Promise<Load<T>> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.success) return { status: "ready", data: body as T };
    return { status: "error", message: typeof body?.error === "string" ? body.error : "Data is unavailable right now." };
  } catch {
    return { status: "error", message: "Couldn't reach the server. Check your connection and try again." };
  }
}

/* ------------------------------------------------------------ formatting */

const DASH = "—";

function fmtDate(day: string | null): string {
  if (!day) return DASH;
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function fmtDay(day: string | null): string {
  if (!day) return DASH;
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

function fmtTime(iso: string | null): string {
  if (!iso) return DASH;
  return `${new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} IST`;
}

const fmtRs = (n: number | null, digits = 2) => (n === null ? DASH : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: digits })}`);

const fmtCr = (cr: number | null) => (cr === null ? DASH : `₹${cr.toLocaleString("en-IN", { maximumFractionDigits: cr >= 100 ? 0 : 2 })} cr`);

const fmtTimes = (x: number | null) => (x === null ? DASH : `${x >= 100 ? x.toFixed(0) : x.toFixed(2)}×`);

const fmtPct = (x: number | null) => (x === null ? DASH : `${x > 0 ? "+" : ""}${x.toFixed(2)}%`);

const toneOf = (x: number | null) => (x === null || x === 0 ? "text-white" : x > 0 ? "text-[#4ade80]" : "text-[#f87171]");

function fmtBand(row: IpoRow): string {
  if (!row.priceBand) return DASH;
  const { low, high } = row.priceBand;
  return low === high ? fmtRs(high) : `${fmtRs(low)}–${high.toLocaleString("en-IN")}`;
}

/* ------------------------------------------------------------ small parts */

const DEMAND_CLASS: Record<DemandLevel, string> = {
  "not-open": "border-[#333] bg-[#151515] text-[#999]",
  "no-data": "border-[#333] bg-[#151515] text-[#999]",
  undersubscribed: "border-[#f87171]/40 bg-[#f87171]/10 text-[#fca5a5]",
  subscribed: "border-[#a3a3a3]/40 bg-[#a3a3a3]/10 text-[#e5e5e5]",
  strong: "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#86efac]",
  "very-strong": "border-[#22c55e]/70 bg-[#22c55e]/20 text-[#4ade80]",
};

function Chip({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${className}`}>{children}</span>;
}

function stateChip(row: IpoRow): { label: string; className: string } {
  if (row.section === "open") return { label: "Open", className: "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#4ade80]" };
  if (row.section === "upcoming") return { label: "Upcoming", className: "border-[#60a5fa]/40 bg-[#60a5fa]/10 text-[#93c5fd]" };
  if (row.listingState === "listed") return { label: "Closed · listed", className: "border-[#333] bg-[#1a1a1a] text-[#c9c9c9]" };
  if (row.listingState === "awaiting") return { label: "Closed · awaiting listing", className: "border-[#f59e0b]/40 bg-[#f59e0b]/10 text-[#fbbf24]" };
  return { label: "Closed", className: "border-[#333] bg-[#1a1a1a] text-[#c9c9c9]" };
}

function Fact({ label, value, sub, tone = "text-white" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-[#1f1f1f] bg-[#0c0c0c] px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[#777]">{label}</p>
      <p className={`mt-1 truncate text-[15px] font-semibold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-snug text-[#777]">{sub}</p>}
    </div>
  );
}

function SourceLine({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[11px] leading-relaxed text-[#6b6b6b]">{children}</p>;
}

/* ------------------------------------------------------------ one IPO */

function Subscription({ row }: { row: IpoRow }) {
  if (row.section === "upcoming") return <Fact label="Subscription" value={DASH} sub="bidding not open" />;
  if (row.subscription === null) return <Fact label="Subscription" value={DASH} sub="not reported by Upstox" />;
  return <Fact label="Subscription" value={fmtTimes(row.subscription)} sub="overall" tone={row.subscription >= 1 ? "text-[#4ade80]" : "text-[#f87171]"} />;
}

function GmpBox({ row, gmp }: { row: IpoRow; gmp: GmpStatus }) {
  const g = row.gmp;
  return (
    <div className="mt-3 rounded-xl border border-dashed border-[#3a3320] bg-[#14110a] px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#d4a23a]">Grey market premium · unofficial</p>
        {g ? (
          <p className="text-sm font-semibold tabular-nums">
            <span className={toneOf(g.value)}>{fmtRs(g.value, 0)}</span>
            <span className="ml-2 text-[#999]">{g.pctOfUpper !== null ? `${fmtPct(g.pctOfUpper)} of upper band` : "band unknown"}</span>
          </p>
        ) : (
          <p className="text-sm text-[#888]">GMP unavailable</p>
        )}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-[#8a7a55]">
        {g
          ? `${gmp.providerName} lists it as “${g.sourceName}”; updated ${fmtTime(gmp.updatedAt)}. Grey-market deals are unregulated and not an exchange price.`
          : gmp.available
            ? `${gmp.providerName} has no GMP for this issue. No figure is estimated.`
            : gmp.reason}
      </p>
    </div>
  );
}

function ListingBox({ row }: { row: IpoRow }) {
  if (row.listingState !== "listed") return null;
  const s = row.session;
  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Fact
          label="Listing price"
          value={fmtRs(row.listingPrice)}
          sub={row.listingPrice === null ? "not reported by Upstox" : `${fmtPct(row.listingGainPct)} vs issue`}
          tone={toneOf(row.listingGainPct)}
        />
        <Fact label="Listing-day close" value={fmtRs(s?.listingDayClose ?? null)} sub={s ? `${fmtPct(s.listingDayClosePct)} vs issue` : "no candle"} tone={toneOf(s?.listingDayClosePct ?? null)} />
        <Fact
          label={`Latest close${s?.latestDate ? ` · ${fmtDay(s.latestDate)}` : ""}`}
          value={fmtRs(s?.latestClose ?? null)}
          sub={s ? `${fmtPct(s.latestPct)} vs issue` : "no candle"}
          tone={toneOf(s?.latestPct ?? null)}
        />
      </div>
      <SourceLine>
        Listing price: Upstox IPO API. Closes: Upstox daily candles for this ISIN. Gains are against the cut-off (issue) price {fmtRs(row.cutOffPrice)}
        {row.cutOffPrice === null ? ", which Upstox has not reported, so no gain is shown" : ""}.
      </SourceLine>
    </>
  );
}

function NewsList({ items }: { items: IpoNewsItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="text-[13px] leading-snug">
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-[#e5e5e5] hover:text-white hover:underline">
            {item.title}
          </a>
          <span className="block text-[11px] text-[#6b6b6b]">
            {item.sourceName} · {fmtTime(item.publishedAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Timeline({ row }: { row: IpoRow }) {
  const t = row.timeline;
  const items: [string, string | null][] = [
    ["Allotment", t?.allotmentDate ?? null],
    ["Refunds", t?.refundDate ?? null],
    ["Listing", t?.listingDate ?? null],
    ["Mandate ends", t?.mandateEndDate ?? null],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-4">
      {items.map(([label, day]) => (
        <div key={label}>
          <dt className="text-[10px] uppercase tracking-[0.06em] text-[#777]">{label}</dt>
          <dd className="text-[#ddd]">{day ? fmtDate(day) : "not announced"}</dd>
        </div>
      ))}
    </dl>
  );
}

function IpoCard({ row, board, news }: { row: IpoRow; board: IpoBoardData; news: Load<IpoNewsData> }) {
  const chip = stateChip(row);
  const headlines = news.status === "ready" ? (news.data.byId[row.id] ?? []) : [];
  const weekCount = news.status === "ready" ? (news.data.weekCount[row.id] ?? 0) : null;

  return (
    <article className="rounded-2xl border border-[#222] bg-[#111] p-4 sm:p-5">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold leading-snug text-white">{row.name}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[#888]">
            {row.symbol && <span className="font-mono text-[#aaa]">{row.symbol}</span>}
            <Chip className="border-[#333] bg-[#151515] text-[#bbb]">{row.board === "sme" ? "SME" : "Mainboard"}</Chip>
            <Chip className={chip.className}>{chip.label}</Chip>
            {row.listingExchanges.length > 0 && <span>{row.listingExchanges.join(" · ")}</span>}
            {row.industry && <span className="text-[#777]">· {row.industry}</span>}
          </div>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <Chip className={DEMAND_CLASS[row.demand.level]}>{row.demand.label}</Chip>
          <span className="text-[11px] text-[#777]">{row.demand.basis}</span>
          <Link
            href={ipoCommunityPath(row.id)}
            aria-label={`${row.name} community`}
            className="mt-1 inline-flex items-center gap-1 rounded-full border border-[#2a2a2a] px-3 py-1 text-[12px] font-medium text-[#ddd] transition-colors hover:border-[#22c55e]/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/40"
          >
            💬 Community
          </Link>
        </div>
      </header>

      <p className="mt-3 text-[13px] text-[#aaa]">
        Bidding <span className="text-white">{fmtDay(row.openDate)} – {fmtDate(row.closeDate)}</span>
        {row.dailyStartTime && row.dailyEndTime && (
          <span className="text-[#777]">
            {" "}
            · {row.dailyStartTime}–{row.dailyEndTime} IST
          </span>
        )}
        <span className="mx-2 text-[#444]">·</span>
        Listing <span className="text-white">{row.timeline?.listingDate ? fmtDate(row.timeline.listingDate) : "not announced"}</span>
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Fact
          label="Price band"
          value={fmtBand(row)}
          sub={row.cutOffPrice !== null && row.section === "closed" ? `cut-off ${fmtRs(row.cutOffPrice)}` : row.priceBand ? "per share" : "not announced"}
        />
        <Fact
          label="Lot size"
          value={row.lotSize === null ? DASH : `${row.lotSize.toLocaleString("en-IN")} sh`}
          sub={
            row.minInvestment !== null && row.minimumQuantity !== null
              ? `min ${row.minimumQuantity.toLocaleString("en-IN")} sh = ${fmtRs(row.minInvestment, 0)} at upper band`
              : row.detailOk
                ? "not reported by Upstox"
                : "details unavailable"
          }
        />
        <Fact label="Issue size" value={fmtCr(row.issueSizeCr)} sub={row.issueSizeCr === null ? "not reported by Upstox" : "total, per Upstox"} />
        <Subscription row={row} />
      </div>
      <SourceLine>
        Upstox IPO API, fetched {fmtTime(board.generatedAt)}
        {row.detailOk ? "" : " — details call failed, so lot size, timeline and listing are missing"}.
      </SourceLine>

      {row.section === "closed" ? <ListingBox row={row} /> : <GmpBox row={row} gmp={board.gmp} />}

      <details className="group mt-3 rounded-xl border border-[#1f1f1f] bg-[#0c0c0c] px-3 py-2 [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-1 text-[13px] text-[#ccc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/40">
          <span>
            Timeline · documents · news
            {weekCount !== null && <span className="ml-1 text-[#777]">({weekCount} headline{weekCount === 1 ? "" : "s"} in 7 days)</span>}
          </span>
          <span aria-hidden="true" className="text-[#777] transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="space-y-4 pb-2 pt-2">
          <Timeline row={row} />
          <p className="text-[12px] text-[#888]">
            {row.faceValue !== null && <>Face value {fmtRs(row.faceValue)} · </>}
            {row.rhpUrl ? (
              <a href={row.rhpUrl} target="_blank" rel="noopener noreferrer" className="text-[#ccc] underline">
                RHP
              </a>
            ) : (
              "RHP not available"
            )}
            {" · "}
            {row.drhpUrl ? (
              <a href={row.drhpUrl} target="_blank" rel="noopener noreferrer" className="text-[#ccc] underline">
                DRHP
              </a>
            ) : (
              "DRHP not available"
            )}
            <span className="text-[#666]"> · links from Upstox</span>
          </p>
          <p className="text-[12px] text-[#777]">Category-wise subscription (QIB, NII, retail) isn&apos;t provided by Upstox&apos;s IPO API.</p>
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#777]">Related news</p>
            {news.status === "loading" && <p className="text-[12px] text-[#777]">Loading headlines…</p>}
            {news.status === "error" && <p className="text-[12px] text-[#777]">News unavailable: {news.message}</p>}
            {news.status === "ready" &&
              (headlines.length ? (
                <NewsList items={headlines} />
              ) : (
                <p className="text-[12px] text-[#777]">No recent headline in the ET Markets IPO or Business Standard Markets feeds mentions this issue.</p>
              ))}
          </div>
        </div>
      </details>
    </article>
  );
}

/* ------------------------------------------------------------ page */

type BoardFilter = "all" | "mainboard" | "sme";

const SECTIONS: { id: IpoSection; label: string; empty: string; hint: string }[] = [
  { id: "open", label: "Open", empty: "No IPOs open right now", hint: "Nothing is in its subscription window today (Indian time)." },
  { id: "upcoming", label: "Upcoming", empty: "No upcoming IPOs with dates", hint: "No issue has announced a subscription window that starts after today." },
  { id: "closed", label: "Closed", empty: "No IPOs closed in the last 30 days", hint: "Closed issues, including listed ones, appear here for 30 days." },
];

function SourcesPanel({ sources }: { sources: SourceStatus[] }) {
  return (
    <ul className="divide-y divide-[#1d1d1d] rounded-2xl border border-[#222] bg-[#111]">
      {sources.map((s) => (
        <li key={s.id + s.name} className="flex items-start gap-3 px-4 py-3 text-[13px]">
          <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${s.ok ? "bg-[#22c55e]" : "bg-[#f59e0b]"}`} />
          <div className="min-w-0">
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[#e5e5e5] hover:underline">
              {s.name}
            </a>
            <p className="text-[11px] text-[#777]">
              {s.ok ? "OK" : "Partly unavailable"} · fetched {fmtTime(s.fetchedAt)}
              {s.note ? ` · ${s.note}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function IpoBoard() {
  const [board, setBoard] = useState<Load<IpoBoardData>>({ status: "loading" });
  const [news, setNews] = useState<Load<IpoNewsData>>({ status: "loading" });
  const [section, setSection] = useState<IpoSection>("open");
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Independent: slow news feeds never hold up the IPO list.
    getJson<IpoBoardData>("/api/ipo").then((b) => !cancelled && setBoard(b));
    getJson<IpoNewsData>("/api/ipo/news").then((n) => !cancelled && setNews(n));
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const retry = useCallback(() => {
    setBoard({ status: "loading" });
    setNews({ status: "loading" });
    setReload((r) => r + 1);
  }, []);

  const data = board.status === "ready" ? board.data : null;
  const counts = useMemo(() => {
    const out: Record<IpoSection, number> = { open: 0, upcoming: 0, closed: 0 };
    for (const row of data?.ipos ?? []) if (filter === "all" || row.board === filter) out[row.section]++;
    return out;
  }, [data, filter]);

  const active = SECTIONS.find((s) => s.id === section)!;
  const rows = (data?.ipos ?? []).filter((r) => r.section === section && (filter === "all" || r.board === filter));
  const unclassified = (data?.unclassified ?? []).filter((u) => filter === "all" || u.board === filter);

  return (
    <PageShell>
      <PageHeader
        eyebrow="India · NSE & BSE"
        title="IPOs"
        description="Mainboard and SME issues from Upstox's IPO API, sorted by their subscription dates in Indian time. Closed issues stay for 30 days, with listing prices once they list."
      />

      {board.status === "loading" && (
        <div role="status" aria-live="polite" className="space-y-3">
          <p className="text-sm text-[#888]">Loading IPOs from Upstox…</p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl border border-[#1d1d1d] bg-[#0f0f0f] motion-reduce:animate-none" />
          ))}
        </div>
      )}

      {board.status === "error" && (
        <EmptyState
          icon="📡"
          title="IPO data is unavailable right now"
          description={board.message}
          action={
            <button type="button" onClick={retry} className="rounded-lg border border-[#333] px-4 py-2 text-sm hover:bg-[#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
              Try again
            </button>
          }
        />
      )}

      {data && (
        <>
          {data.staleReason && (
            <p role="status" className="mb-4 rounded-xl border border-[#3a3320] bg-[#14110a] px-4 py-2.5 text-[13px] text-[#c9a95a]">
              Showing data fetched {fmtTime(data.generatedAt)}: the latest refresh failed. {data.staleReason}
            </p>
          )}

          <div className="mb-6 grid grid-cols-3 gap-3">
            <StatCard label="Open" value={counts.open} tone={counts.open ? "up" : "neutral"} />
            <StatCard label="Upcoming" value={counts.upcoming} />
            <StatCard label="Closed · 30 days" value={counts.closed} />
          </div>

          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div role="tablist" aria-label="IPO section" className="grid grid-cols-3 gap-1 rounded-xl border border-[#222] bg-[#0d0d0d] p-1 sm:flex">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  id={`ipo-tab-${s.id}`}
                  aria-selected={section === s.id}
                  aria-controls="ipo-section-panel"
                  onClick={() => setSection(s.id)}
                  className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/40 ${
                    section === s.id ? "bg-[#1c1c1c] text-white" : "text-[#999] hover:text-white"
                  }`}
                >
                  {s.label} <span className="text-[#666]">{counts[s.id]}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-1" role="group" aria-label="Board">
              {(["all", "mainboard", "sme"] as BoardFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/40 ${
                    filter === f ? "border-[#22c55e]/50 bg-[#22c55e]/10 text-[#4ade80]" : "border-[#2a2a2a] text-[#aaa] hover:text-white"
                  }`}
                >
                  {f === "all" ? "All" : f === "mainboard" ? "Mainboard" : "SME"}
                </button>
              ))}
            </div>
          </div>

          <div id="ipo-section-panel" role="tabpanel" aria-labelledby={`ipo-tab-${section}`}>
            <h2 className="sr-only">{active.label} IPOs</h2>
            {rows.length === 0 ? (
              <EmptyState icon="🗓️" title={active.empty} description={`${active.hint} Dates checked against ${fmtDate(data.today)} in India.`} />
            ) : (
              <div className="space-y-4">
                {rows.map((row) => (
                  <IpoCard key={row.id} row={row} board={data} news={news} />
                ))}
              </div>
            )}
          </div>

          {unclassified.length > 0 && (
            <details className="mt-6 rounded-2xl border border-dashed border-[#2a2a2a] bg-[#0b0b0b] px-4 py-3 text-[13px]">
              <summary className="cursor-pointer text-[#aaa]">
                {unclassified.length} IPO{unclassified.length === 1 ? "" : "s"} not in any section — Upstox lists {unclassified.length === 1 ? "it" : "them"} without subscription dates
              </summary>
              <p className="mt-2 text-[12px] text-[#777]">
                An issue&apos;s section is only decided from its real subscription dates; these are left out until dates are announced.
              </p>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {unclassified.map((u) => (
                  <li key={u.id} className="text-[#ccc]">
                    {u.name} <span className="text-[11px] text-[#777]">· {u.board === "sme" ? "SME" : "Mainboard"} · {u.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <section className="mt-10">
            <h2 className="mb-3 text-lg font-semibold tracking-tight">How demand is measured</h2>
            <div className="rounded-2xl border border-[#222] bg-[#111] p-5 text-[13px] leading-relaxed text-[#aaa]">
              <p>{DEMAND_DEFINITION}</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {DEMAND_BANDS.map((b) => (
                  <li key={b.level}>
                    <Chip className={DEMAND_CLASS[b.level]}>
                      {b.label}: {b.max === null ? `${b.min}× and over` : b.min === 0 ? `under ${b.max}×` : `${b.min}–${b.max}×`}
                    </Chip>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12px] text-[#777]">Upcoming issues show &quot;Not open yet&quot;: there is no demand to measure before bidding starts.</p>
            </div>
          </section>

          <section className="mt-10">
            <h2 className="mb-3 text-lg font-semibold tracking-tight">IPO headlines</h2>
            {news.status === "loading" && <p className="text-sm text-[#888]">Loading headlines…</p>}
            {news.status === "error" && <EmptyState icon="📰" title="IPO news is unavailable" description={news.message} />}
            {news.status === "ready" &&
              (news.data.items.length ? (
                <div className="rounded-2xl border border-[#222] bg-[#111] p-5">
                  <NewsList items={news.data.items.slice(0, 15)} />
                </div>
              ) : (
                <EmptyState icon="📰" title="No IPO headlines" description="The news feeds returned no IPO headlines right now." />
              ))}
          </section>

          <section className="mt-10">
            <h2 className="mb-1 text-lg font-semibold tracking-tight">Sources</h2>
            <p className="mb-3 text-[12px] text-[#777]">
              IPO data fetched {fmtTime(data.generatedAt)} from Upstox&apos;s official IPO API. Grey market premium: {data.gmp.available ? data.gmp.providerName : "unavailable"}.
            </p>
            <SourcesPanel sources={[...data.sources, ...(news.status === "ready" ? news.data.sources : [])]} />
          </section>
        </>
      )}
    </PageShell>
  );
}
