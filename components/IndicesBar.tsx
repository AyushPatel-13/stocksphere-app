"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { useMarketCalendar } from "@/lib/client/useMarketCalendar";
import { marketSession, type Market } from "@/lib/markets/session";
import type { LiveIndex } from "@/lib/services/indices";
import { formatIndexValue } from "@/lib/utils/format";

/** The indices the home strip shows, in order. /indices lists all of them. */
const BAR_SYMBOLS = ["NIFTY", "SENSEX", "BANKNIFTY", "SPX", "DOW", "NASDAQ100"];

const BAR_LABELS: Record<string, string> = {
  NIFTY: "NIFTY 50",
  SENSEX: "SENSEX",
  BANKNIFTY: "NIFTY BANK",
  SPX: "S&P 500",
  DOW: "DOW JONES",
  NASDAQ100: "NASDAQ 100",
};

const REFRESH_MS = 60_000;

type BarState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; indices: LiveIndex[] };

/** "9 Nov, 4:00 pm" in the exchange's own time zone, or null for a missing or unreadable time. */
export function formatExchangeTime(iso: string | null | undefined, market: Market): string | null {
  const at = Date.parse(iso ?? "");
  if (!Number.isFinite(at)) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: market === "IN" ? "Asia/Kolkata" : "America/New_York",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(at));
}

/**
 * Whether each market is open, why not when it's closed for a holiday, and
 * the time the figures above are from: a holiday's prices are the last
 * session's, and the strip shouldn't leave that to be guessed.
 */
function MarketStatusLine({ indices, now }: { indices: Map<string, LiveIndex>; now: number }) {
  const calendar = useMarketCalendar();
  const markets: { market: Market; name: string; zone: string; symbol: string }[] = [
    { market: "IN", name: "NSE", zone: "IST", symbol: "NIFTY" },
    { market: "US", name: "US", zone: "ET", symbol: "SPX" },
  ];

  return (
    <div className="mx-auto mt-2 flex w-full max-w-[1080px] flex-wrap gap-x-5 gap-y-1 px-1 text-[12px] text-[#8a8a8a]">
      {markets.map(({ market, name, zone, symbol }) => {
        const status = marketSession(market, now, calendar);
        const asOf = formatExchangeTime(indices.get(symbol)?.lastUpdated, market);
        return (
          <span key={market} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${status.scheduled === "open" ? "bg-[#22c55e]" : "bg-[#555]"}`} />
            <span className="text-[#bdbdbd]">{name}:</span> {status.label}
            {asOf && <span className="text-[#6f6f6f]">· prices as of {asOf} {zone}</span>}
          </span>
        );
      })}
    </div>
  );
}

export default function IndicesBar({ showStatus = true }: { showStatus?: boolean }) {
  const [state, setState] = useState<BarState>({ status: "loading" });
  // Set after mount: the server's clock and the browser's would disagree in the first render.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/indices", { cache: "no-store" });
        const result = await response.json();

        if (cancelled) return;
        // The clock the open/closed line is judged by, refreshed with the figures.
        setNow(Date.now());

        if (!result?.success || !Array.isArray(result.data)) {
          // Keep the last good figures on a failed refresh; only the first
          // load falls back to the error state.
          setState((previous) =>
            previous.status === "ready" ? previous : { status: "error" }
          );
          return;
        }

        setState({ status: "ready", indices: result.data as LiveIndex[] });
      } catch {
        if (cancelled) return;

        setState((previous) =>
          previous.status === "ready" ? previous : { status: "error" }
        );
      }
    }

    load();

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const bySymbol = new Map(
    state.status === "ready"
      ? state.indices.map((index) => [index.symbol, index])
      : []
  );

  return (
    <section className="mb-8 w-full px-4 sm:px-6 lg:px-8" aria-label="Market indices">
      <div className="mx-auto flex w-full max-w-[1080px] overflow-hidden rounded-xl border border-[#242424] bg-[#0d0d0d]">
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {BAR_SYMBOLS.map((symbol) => {
            const index = bySymbol.get(symbol);
            const hasPrice = index?.price != null;
            const positive = (index?.change ?? 0) >= 0;

            return (
              <Link
                key={symbol}
                href={`/asset/index/${symbol}`}
                className="min-w-[150px] flex-1 border-r border-[#242424] px-4 py-3 text-left transition-colors last:border-r-0 hover:bg-[#161616] focus-visible:bg-[#161616] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-500/40"
              >
                <div className="text-[12px] font-medium text-[#bdbdbd]">
                  {BAR_LABELS[symbol]}
                </div>

                <div className="mt-1 flex items-center gap-2">
                  {state.status === "loading" ? (
                    <span
                      className="h-[14px] w-24 animate-pulse rounded bg-[#1f1f1f]"
                      aria-hidden="true"
                    />
                  ) : hasPrice && index ? (
                    <>
                      <span className="text-[14px] font-semibold text-white">
                        {formatIndexValue(index.price, index.category)}
                      </span>

                      <span
                        className={`text-[12px] font-medium ${
                          positive ? "text-[#4ade80]" : "text-[#f87171]"
                        }`}
                      >
                        {index.changePercent !== null
                          ? `${index.changePercent >= 0 ? "+" : ""}${index.changePercent.toFixed(2)}%`
                          : "—"}
                      </span>
                    </>
                  ) : (
                    <span className="text-[13px] text-[#666]">Unavailable</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>

        {/* All Markets button */}
        <Link
          href="/indices"
          aria-label="View all markets"
          title="View all markets"
          className="flex h-[66px] w-[66px] shrink-0 items-center justify-center border-l border-[#242424] text-[#a1a1aa] transition-colors hover:bg-[#161616] hover:text-white focus-visible:bg-[#161616] focus-visible:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-500/40"
        >
          <span className="grid grid-cols-2 gap-[3px]">
            <span className="h-[5px] w-[5px] rounded-[1px] bg-current" />
            <span className="h-[5px] w-[5px] rounded-[1px] bg-current" />
            <span className="h-[5px] w-[5px] rounded-[1px] bg-current" />
            <span className="h-[5px] w-[5px] rounded-[1px] bg-current" />
          </span>
        </Link>
      </div>

      {showStatus && now !== null && state.status === "ready" && <MarketStatusLine indices={bySymbol} now={now} />}
    </section>
  );
}
