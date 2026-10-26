"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import Feed from "@/components/Community/Feed";
import { PageShell } from "@/components/ui/Page";
import { CATEGORY_LABEL, bondFacts, formatCoupon, formatMaturity, sectorOf, type Bond } from "@/lib/bonds/bonds";
import { useCommunityUser } from "@/lib/community/client";
import { mentionTextFor, type MentionPick } from "@/lib/community/mentionInput";

/**
 * One bond: its exchange record (verified fields only — "not stated" where
 * the listing doesn't give one) and the community posts that @mention it.
 * Posts aren't copied here: this is the same feed, filtered to the bond.
 */

const DASH = "—";

function Fact({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[#1f1f1f] bg-[#0c0c0c] px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[#777]">{label}</p>
      <p className="mt-1 truncate text-[15px] font-semibold tabular-nums text-white">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-snug text-[#777]">{sub}</p>}
    </div>
  );
}

export function seedFor(bond: Bond): MentionPick {
  const symbol = bond.listings[0]?.symbol ?? bond.isin;
  return { kind: "bond", isin: bond.isin, text: mentionTextFor({ kind: "bond", symbol }), name: bond.name, detail: bondFacts(bond) };
}

export default function BondCommunity({ isin, bond }: { isin: string; bond: Bond | null }) {
  const user = useCommunityUser();

  return (
    <PageShell>
      <Link href="/bonds" className="mb-4 inline-block text-sm text-[#888] hover:text-white">
        ← All bonds
      </Link>

      <header className="mb-6 rounded-2xl border border-[#222] bg-[#111] p-4 sm:p-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#38bdf8]">Bond</p>
        <h1 className="break-words text-[24px] font-bold leading-tight tracking-tight sm:text-[28px]">{bond?.name ?? isin}</h1>

        {bond ? (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="inline-flex items-center rounded-full border border-[#38bdf8]/40 bg-[#38bdf8]/10 px-2.5 py-0.5 font-medium text-[#7dd3fc]">
                {CATEGORY_LABEL[bond.category]}
              </span>
              <span className="inline-flex items-center rounded-full border border-[#333] bg-[#151515] px-2.5 py-0.5 font-medium text-[#bbb]">
                {sectorOf(bond.category) === "government" ? "Government" : "Corporate"}
              </span>
              {bond.listings.map((l) => (
                <span key={l.exchange} className="text-[#888]">
                  · {l.exchange}: {l.symbol}
                </span>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Fact label="Issuer" value={bond.issuer ?? DASH} sub={bond.issuer ? undefined : "not stated in the listing"} />
              <Fact
                label="Coupon"
                value={bond.coupon === null ? DASH : formatCoupon(bond.coupon)}
                sub={bond.category === "tbill" ? "issued at a discount" : bond.coupon === null ? "not stated in the listing" : "a year"}
              />
              <Fact label="Maturity" value={bond.maturity ? formatMaturity(bond.maturity) : DASH} sub={bond.maturity ? undefined : "not stated in the listing"} />
              <Fact label="ISIN" value={bond.isin} sub={bond.currency} />
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-[#6b6b6b]">
              From the NSE/BSE listing (via Upstox): description, ISIN and instrument type. Coupon and maturity are as printed in the exchange&apos;s
              description. No prices or yields are shown here. For information only, not investment advice.
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-[#888]">This bond&apos;s listing details can&apos;t be loaded right now. Its discussion is below.</p>
        )}
      </header>

      <h2 className="mb-3 text-lg font-semibold">Discussion</h2>
      <Feed user={user} bond={{ isin, seed: bond ? seedFor(bond) : undefined }} label={bond?.name ?? "this bond"} />
    </PageShell>
  );
}
