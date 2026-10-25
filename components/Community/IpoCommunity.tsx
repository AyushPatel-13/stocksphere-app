"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import Feed from "@/components/Community/Feed";
import { SentimentMeter } from "@/components/Community/StockBoard";
import { PageShell, secondaryButtonClass } from "@/components/ui/Page";
import { fetchIpoCommunity, useCommunityUser, type IpoCommunityData } from "@/lib/community/client";
import type { IpoSummary } from "@/lib/community/ipoCommunity";

/**
 * One IPO's community: the issue's details from Upstox (real figures only;
 * "—" when Upstox hasn't published one), then the same sentiment meter, post
 * box and feed as a stock board. When the issue lists and the listing service
 * links it, the header says so and links the stock, whose board shows these
 * same posts.
 */

type State = { status: "loading" } | { status: "error"; message: string; notFound: boolean } | { status: "ready"; data: IpoCommunityData };

const DASH = "—";

function fmtDate(day: string | null): string {
  if (!day) return DASH;
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function fmtTime(iso: string): string {
  return `${new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} IST`;
}

const fmtRs = (n: number | null) => (n === null ? DASH : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);

function fmtBand(ipo: IpoSummary): string {
  if (!ipo.priceBand) return DASH;
  const { low, high } = ipo.priceBand;
  return low === high ? fmtRs(high) : `${fmtRs(low)}–${high.toLocaleString("en-IN")}`;
}

function Chip({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${className}`}>{children}</span>;
}

const NEUTRAL = "border-[#333] bg-[#151515] text-[#bbb]";

function statusChip(ipo: IpoSummary | null): { label: string; className: string } | null {
  if (!ipo) return null;
  if (ipo.section === "open") return { label: "IPO open", className: "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#4ade80]" };
  if (ipo.section === "upcoming") return { label: "IPO upcoming", className: "border-[#60a5fa]/40 bg-[#60a5fa]/10 text-[#93c5fd]" };
  if (ipo.section === "closed") {
    return ipo.listingState === "listed"
      ? { label: "IPO closed · listed per Upstox", className: NEUTRAL }
      : { label: "IPO closed", className: NEUTRAL };
  }
  return { label: "Dates not announced", className: NEUTRAL };
}

function Fact({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[#1f1f1f] bg-[#0c0c0c] px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[#777]">{label}</p>
      <p className="mt-1 truncate text-[15px] font-semibold tabular-nums text-white">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-snug text-[#777]">{sub}</p>}
    </div>
  );
}

function Header({ data }: { data: IpoCommunityData }) {
  const { ipo, community } = data;
  const name = ipo?.name ?? community?.name ?? data.ipoId;
  const chip = statusChip(ipo);
  const linked = community?.type === "stock" && community.stockPath;

  return (
    <header className="mb-6 rounded-2xl border border-[#222] bg-[#111] p-4 sm:p-5">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#22c55e]">IPO community</p>
      <h1 className="text-[26px] font-bold leading-tight tracking-tight sm:text-[30px]">{name}</h1>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[#888]">
        {(ipo?.board ?? community?.board) && <Chip className={NEUTRAL}>{(ipo?.board ?? community?.board) === "sme" ? "SME" : "Mainboard"}</Chip>}
        {chip && <Chip className={chip.className}>{chip.label}</Chip>}
        {linked ? (
          <Chip className="border-[#22c55e]/40 bg-[#22c55e]/10 text-[#4ade80]">
            Listed · {community.exchange}: {community.symbol}
          </Chip>
        ) : (
          <Chip className="border-[#f59e0b]/40 bg-[#f59e0b]/10 text-[#fbbf24]">Not yet listed</Chip>
        )}
        {ipo?.industry && <span className="text-[#777]">· {ipo.industry}</span>}
      </div>

      {linked && (
        <p className="mt-3 text-[13px] text-[#aaa]">
          This community is now {community.symbol}&apos;s stock community. Its posts also appear on the{" "}
          <Link href={community.stockPath!} className="font-semibold text-[#22c55e] hover:text-[#4ade80]">
            {community.symbol} stock page
          </Link>
          .
        </p>
      )}
      {!linked && ipo?.listingState === "listed" && (
        <p className="mt-3 text-[13px] text-[#888]">
          Upstox reports this issue as listed. It joins its stock&apos;s page once its ISIN is matched to an NSE or BSE ticker.
        </p>
      )}

      {ipo ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Fact label="Price band" value={fmtBand(ipo)} sub={ipo.priceBand ? "per share" : "not announced"} />
            <Fact label="Lot size" value={ipo.lotSize === null ? DASH : `${ipo.lotSize.toLocaleString("en-IN")} sh`} sub={ipo.lotSize === null ? "not reported by Upstox" : undefined} />
            <Fact
              label="Issue size"
              value={ipo.issueSizeCr === null ? DASH : `₹${ipo.issueSizeCr.toLocaleString("en-IN", { maximumFractionDigits: 2 })} cr`}
              sub={ipo.issueSizeCr === null ? "not reported by Upstox" : undefined}
            />
            <Fact
              label="Subscription"
              value={ipo.subscription === null ? DASH : `${ipo.subscription.toFixed(2)}×`}
              sub={ipo.section === "upcoming" ? "bidding not open" : ipo.subscription === null ? "not reported by Upstox" : "overall"}
            />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-4">
            {(
              [
                ["Bidding opens", fmtDate(ipo.openDate)],
                ["Bidding closes", fmtDate(ipo.closeDate)],
                ["Listing", ipo.listingDate ? fmtDate(ipo.listingDate) : "not announced"],
                ["Exchanges", ipo.listingExchanges.length ? ipo.listingExchanges.join(" · ") : "not reported"],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-[10px] uppercase tracking-[0.06em] text-[#777]">{label}</dt>
                <dd className="text-[#ddd]">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed text-[#6b6b6b]">
            Upstox IPO API, fetched {fmtTime(ipo.fetchedAt)}
            {ipo.listingPrice !== null && <> · listing price {fmtRs(ipo.listingPrice)}</>}
            {ipo.rhpUrl && (
              <>
                {" · "}
                <a href={ipo.rhpUrl} target="_blank" rel="noopener noreferrer" className="text-[#aaa] underline">
                  RHP
                </a>
              </>
            )}
            . No grey market premium is shown: it&apos;s unofficial and no source that permits republishing is configured.
          </p>
        </>
      ) : (
        <p className="mt-3 rounded-xl border border-[#2a2a2a] bg-[#0c0c0c] px-3 py-2.5 text-[13px] text-[#999]">
          IPO details are unavailable right now{data.ipoError ? `: ${data.ipoError.message}` : "."} The discussion below still works.
        </p>
      )}
    </header>
  );
}

export default function IpoCommunity({ ipoId }: { ipoId: string }) {
  const user = useCommunityUser();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchIpoCommunity(ipoId).then((result) => {
      if (cancelled) return;
      setState("error" in result ? { status: "error", message: result.error, notFound: result.code === "NOT_FOUND" } : { status: "ready", data: result });
    });
    return () => {
      cancelled = true;
    };
  }, [ipoId, attempt]);

  return (
    <PageShell>
      <p className="mb-4 text-[13px]">
        <Link href="/ipo" className="text-[#888] hover:text-white">
          ← All IPOs
        </Link>
      </p>

      {state.status === "loading" && (
        <div className="space-y-4">
          <div className="h-48 animate-pulse rounded-2xl bg-[#111]" />
          <div className="h-[74px] animate-pulse rounded-2xl bg-[#111]" />
          <div className="h-32 animate-pulse rounded-2xl bg-[#111]" />
        </div>
      )}

      {state.status === "error" && (
        <div className="rounded-2xl border border-[#222] bg-[#111] px-6 py-10 text-center">
          <p className="font-semibold">{state.notFound ? "IPO not found" : "This community couldn't be loaded"}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#888]">{state.message}</p>
          {!state.notFound && (
            <button
              type="button"
              onClick={() => {
                setState({ status: "loading" });
                setAttempt((n) => n + 1);
              }}
              className={`${secondaryButtonClass} mt-4`}
            >
              Try again
            </button>
          )}
        </div>
      )}

      {state.status === "ready" && (
        <IpoDiscussion data={state.data} user={user} refresh={refresh} onPosted={() => setRefresh((n) => n + 1)} />
      )}
    </PageShell>
  );
}

function IpoDiscussion({
  data,
  user,
  refresh,
  onPosted,
}: {
  data: IpoCommunityData;
  user: ReturnType<typeof useCommunityUser>;
  refresh: number;
  onPosted: () => void;
}) {
  // The community's own IPO id: the one its posts are filed under.
  const ipoId = data.community?.ipoId ?? data.ipoId;
  const name = data.ipo?.name ?? data.community?.name ?? "this IPO";

  return (
    <>
      <Header data={data} />

      {data.communityStatus === "not_configured" ? (
        <div className="rounded-2xl border border-dashed border-[#2a2a2a] bg-[#0b0b0b] px-6 py-12 text-center">
          <p className="text-2xl" aria-hidden="true">💬</p>
          <p className="mt-3 font-semibold">IPO discussions are launching soon</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-[#888]">Posting on {name} opens as soon as IPO communities are switched on.</p>
        </div>
      ) : (
        <section aria-labelledby="ipo-board-title">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="ipo-board-title" className="text-xl font-semibold tracking-tight">
              Discussion
            </h2>
            <span className="text-xs text-[#777]">Community views · not investment advice</span>
          </div>
          <div className="mb-4">
            <SentimentMeter ipoId={ipoId} refresh={refresh} />
          </div>
          <Feed user={user} ipoId={ipoId} label={name} onPosted={onPosted} />
        </section>
      )}
    </>
  );
}
