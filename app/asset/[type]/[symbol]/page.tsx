"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import PriceChart from "@/components/Charts/PriceChart";
import StockBoard from "@/components/Community/StockBoard";
import { StockAvatar } from "@/components/Markets/StockBits";
import { AllIndices, Nifty50Constituents, Performance, SupportResistance } from "@/components/Markets/IndexDetails";
import { PageShell } from "@/components/ui/Page";
import type { AssetType, ValueUnit } from "@/lib/data/assets";

/**
 * One page for every non-stock asset: an index, an ETF, a coin or a bond.
 * /asset/index/NIFTY · /asset/etf/NIFTYBEES · /asset/crypto/BTC?vs=usd ·
 * /asset/bond/US10Y. Stocks keep their own, richer page at /stock/[symbol].
 */

const TYPE_LABEL: Record<Exclude<AssetType, "stock">, string> = {
  index: "Index",
  etf: "ETF",
  crypto: "Crypto",
  bond: "Bond",
};

const HUB: Record<Exclude<AssetType, "stock">, { href: string; label: string }> = {
  index: { href: "/indices", label: "All indices" },
  etf: { href: "/etfs", label: "All ETFs" },
  crypto: { href: "/crypto", label: "All crypto" },
  bond: { href: "/bonds", label: "All bonds" },
};

type DayStats = {
  name: string | null;
  unit: ValueUnit;
  currency: string | null;
  last: number | null;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
};

function useDayStats(type: string, symbol: string, vs: string) {
  const [stats, setStats] = useState<DayStats | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ type, symbol, range: "1d", vs });

    fetch(`/api/history?${params.toString()}`)
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        if (!data?.success) {
          setStats(null);
          return;
        }
        const candles: { o: number | null; h: number | null; l: number | null; c: number }[] = data.candles;
        const highs = candles.map((c) => c.h ?? c.c);
        const lows = candles.map((c) => c.l ?? c.c);
        setStats({
          name: data.name,
          unit: data.unit,
          currency: data.currency,
          last: candles.at(-1)?.c ?? null,
          previousClose: data.previousClose,
          open: candles[0]?.o ?? candles[0]?.c ?? null,
          high: highs.length ? Math.max(...highs) : null,
          low: lows.length ? Math.min(...lows) : null,
          fiftyTwoWeekHigh: data.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: data.fiftyTwoWeekLow,
        });
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });

    return () => {
      cancelled = true;
    };
  }, [type, symbol, vs]);

  return stats;
}

function AssetView() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();

  const type = String(params.type ?? "") as Exclude<AssetType, "stock">;
  const symbol = decodeURIComponent(String(params.symbol ?? "")).toUpperCase();
  const vs = search.get("vs")?.toUpperCase() === "USD" ? "USD" : "INR";

  const valid = type in TYPE_LABEL;
  const stats = useDayStats(type, symbol, vs);

  if (!valid) {
    return <p className="text-sm text-[#888]">Unknown asset type.</p>;
  }

  return (
    <>
      <Link href={HUB[type].href} className="mb-4 inline-block text-sm text-[#888] hover:text-white">
        ← {HUB[type].label}
      </Link>

      <header className="mb-6 flex flex-wrap items-center gap-4">
        <StockAvatar symbol={symbol} size={52} type={type} market={type === "crypto" ? "Global" : undefined} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[26px] font-bold tracking-tight">
              {stats?.name ?? symbol}
            </h1>
            <span className="rounded-md border border-[#2a2a2a] px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#999]">
              {TYPE_LABEL[type]}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-[#888]">
            {symbol}
            {stats?.unit === "currency" && stats.currency && ` · ${stats.currency}`}
            {stats?.unit === "points" && " · points"}
            {stats?.unit === "percent" && " · yield %"}
          </p>
        </div>

        {type === "crypto" && (
          <div role="group" aria-label="Currency" className="flex rounded-xl border border-[#2a2a2a] bg-[#111] p-1">
            {(["INR", "USD"] as const).map((currency) => (
              <button
                key={currency}
                type="button"
                aria-pressed={vs === currency}
                onClick={() => router.replace(`/asset/crypto/${symbol}?vs=${currency.toLowerCase()}`)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  vs === currency ? "bg-[#22c55e] text-black" : "text-[#999] hover:text-white"
                }`}
              >
                {currency === "INR" ? "₹ INR" : "$ USD"}
              </button>
            ))}
          </div>
        )}
      </header>

      {stats === null && (
        <p className="mb-4 rounded-xl border border-[#2a2a2a] bg-[#151515] px-4 py-3 text-sm text-[#888]">
          Today&apos;s figures aren&apos;t available right now.
        </p>
      )}

      <PriceChart key={`${type}-${symbol}-${vs}`} type={type} symbol={symbol} vs={vs} />

      <Performance stats={stats} />

      {(type === "index" || type === "etf") && (
        <SupportResistance type={type} symbol={symbol} vs={vs} last={stats?.last ?? null} />
      )}

      {type === "index" && symbol === "NIFTY" && <Nifty50Constituents />}

      {type === "index" && <AllIndices current={symbol} />}

      <div className="mt-10" />
      {type !== "bond" && <StockBoard symbol={symbol} label={stats?.name ?? symbol} />}

      <p className="mt-8 text-[11px] text-[#666]">
        Market data from Yahoo Finance; may be delayed. For information only — not investment advice.
      </p>
    </>
  );
}

export default function AssetPage() {
  return (
    <PageShell>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-[#111]" />}>
        <AssetView />
      </Suspense>
    </PageShell>
  );
}
