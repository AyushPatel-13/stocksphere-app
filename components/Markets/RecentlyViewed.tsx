"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Change, StockAvatar } from "@/components/Markets/StockBits";
import { formatMoney, useQuotes } from "@/lib/client/useQuotes";
import {
  clearRecentlyViewed,
  getRecentlyViewed,
  type RecentlyViewedAsset,
} from "@/lib/utils/recentlyViewed";

/**
 * Recently viewed stocks, Groww-style: a horizontally scrolling row of small
 * cards with a live price and day change, newest first.
 *
 * The list lives in this browser (lib/utils/recentlyViewed.ts) and is filled
 * by every stock page visit. Renders nothing until there is something to show.
 */
export default function RecentlyViewed({ className = "" }: { className?: string }) {
  const [assets, setAssets] = useState<RecentlyViewedAsset[] | null>(null);

  // Read after mount so the first client render matches the server's.
  useEffect(() => {
    const timer = window.setTimeout(() => setAssets(getRecentlyViewed()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const symbols = useMemo(() => (assets ?? []).map((asset) => asset.symbol), [assets]);
  const { loading, quotes } = useQuotes(symbols);

  if (!assets || assets.length === 0) return null;

  return (
    <section className={className} aria-labelledby="recently-viewed-title">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id="recently-viewed-title" className="text-xl font-semibold tracking-tight">
          Recently viewed
        </h2>
        <button
          type="button"
          onClick={() => {
            clearRecentlyViewed();
            setAssets([]);
          }}
          className="text-sm text-[#888] transition-colors hover:text-white"
        >
          Clear
        </button>
      </div>

      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:px-0">
        {assets.map((asset) => {
          const symbol = asset.symbol.toUpperCase();
          const quote = quotes[symbol] ?? null;

          return (
            <li key={`${asset.type}-${symbol}`} className="w-[168px] shrink-0 snap-start">
              <Link
                href={`/stock/${encodeURIComponent(symbol)}`}
                className="group flex h-full flex-col rounded-2xl border border-[#222] bg-[#111] p-4 transition-colors hover:border-[#2f2f2f] hover:bg-[#141414]"
              >
                <StockAvatar symbol={symbol} size={34} market={asset.market === "INDIA" ? "India" : asset.market === "US" ? "US" : undefined} />

                <p className="mt-3 line-clamp-2 min-h-[2.5em] text-sm font-medium leading-tight text-[#e5e5e5] group-hover:text-white">
                  {asset.name || symbol}
                </p>
                <p className="mt-0.5 text-[11px] text-[#666]">
                  {symbol}
                  {asset.market ? ` · ${asset.market === "INDIA" ? "NSE" : "US"}` : ""}
                </p>

                <div className="mt-3">
                  {quote ? (
                    <>
                      <p className="font-semibold tabular-nums">
                        {formatMoney(quote.price, quote.currency)}
                      </p>
                      <p className="mt-0.5 text-xs">
                        <Change change={quote.change} percent={quote.changePercent} />
                      </p>
                    </>
                  ) : loading ? (
                    <>
                      <span className="block h-4 w-20 animate-pulse rounded bg-[#1c1c1c]" />
                      <span className="mt-1.5 block h-3 w-14 animate-pulse rounded bg-[#1a1a1a]" />
                    </>
                  ) : (
                    <p className="text-xs text-[#777]">Price unavailable</p>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
