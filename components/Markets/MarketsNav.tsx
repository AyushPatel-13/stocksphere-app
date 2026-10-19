"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import type { LiveIndex } from "@/lib/services/indices";
import { formatIndexValue } from "@/lib/utils/format";

/**
 * The Markets section header: Explore / Holdings / Watchlist tabs over a
 * one-line live index ticker. Rendered at the top of each of those pages so the
 * three read as one section.
 */
const TABS = [
  { href: "/explore", label: "Explore" },
  { href: "/portfolio", label: "Holdings" },
  { href: "/watchlist", label: "Watchlist" },
];

const TICKER = ["NIFTY", "SENSEX", "BANKNIFTY", "NIFTYIT", "NIFTYNEXT50", "SPX", "DOW", "NASDAQ100"];

const TICKER_LABELS: Record<string, string> = {
  NIFTY: "NIFTY",
  SENSEX: "SENSEX",
  BANKNIFTY: "BANKNIFTY",
  NIFTYIT: "NIFTY IT",
  NIFTYNEXT50: "NIFTY NEXT 50",
  SPX: "S&P 500",
  DOW: "DOW",
  NASDAQ100: "NASDAQ 100",
};

function IndexTicker() {
  const [indices, setIndices] = useState<LiveIndex[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await (await fetch("/api/indices")).json();
        if (!cancelled && Array.isArray(result?.data)) setIndices(result.data);
      } catch {
        // Keep whatever is on screen; the ticker is supplementary.
      }
    }

    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const bySymbol = new Map((indices ?? []).map((index) => [index.symbol, index]));
  // Only indices that actually have a price; an unavailable market simply
  // drops out of the strip instead of showing a row of dashes.
  const shown = TICKER.map((symbol) => bySymbol.get(symbol)).filter(
    (index): index is LiveIndex => index?.price != null
  );

  return (
    <div className="flex items-center gap-3 border-b border-[#1f1f1f]">
      <div className="navbar-scroll flex min-w-0 flex-1 items-center gap-7 overflow-x-auto py-3 [scrollbar-width:none]">
        {indices === null
          ? Array.from({ length: 5 }).map((_, i) => (
              <span key={i} className="h-4 w-44 shrink-0 animate-pulse rounded bg-[#151515]" />
            ))
          : shown.length === 0
            ? <span className="text-xs text-[#666]">Index data is unavailable right now.</span>
            : shown.map((index) => {
                const up = (index.change ?? 0) >= 0;
                return (
                  <Link
                    key={index.symbol}
                    href={`/asset/index/${index.symbol}`}
                    className="flex shrink-0 items-baseline gap-2 rounded text-[13px] hover:opacity-80"
                  >
                    <span className="font-semibold text-[#e5e5e5]">
                      {TICKER_LABELS[index.symbol] ?? index.name}
                    </span>
                    <span className="tabular-nums text-[#bdbdbd]">
                      {formatIndexValue(index.price, index.category)}
                    </span>
                    {index.change !== null && index.changePercent !== null && (
                      <span className={`tabular-nums ${up ? "text-[#4ade80]" : "text-[#f87171]"}`}>
                        {up ? "+" : ""}
                        {index.change.toFixed(2)} ({Math.abs(index.changePercent).toFixed(2)}%)
                      </span>
                    )}
                  </Link>
                );
              })}
      </div>

      <Link
        href="/indices"
        aria-label="All indices"
        title="All indices"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#2a2a2a] text-[#aaa] transition-colors hover:border-[#3a3a3a] hover:text-white"
      >
        🌐
      </Link>
    </div>
  );
}

export default function MarketsNav() {
  const pathname = usePathname();

  return (
    <div className="mb-8">
      <nav aria-label="Markets" className="flex gap-1 border-b border-[#1f1f1f]">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`relative px-4 py-3 text-[15px] font-medium transition-colors ${
                active ? "text-white" : "text-[#888] hover:text-white"
              }`}
            >
              {tab.label}
              {active && (
                <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-[#22c55e]" />
              )}
            </Link>
          );
        })}
      </nav>

      <IndexTicker />
    </div>
  );
}
