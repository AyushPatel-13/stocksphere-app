"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

export default function IndicesBar() {
  const [state, setState] = useState<BarState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/indices", { cache: "no-store" });
        const result = await response.json();

        if (cancelled) return;

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
                className="min-w-[150px] flex-1 border-r border-[#242424] px-4 py-3 text-left transition-colors last:border-r-0 hover:bg-[#161616]"
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
          className="flex h-[66px] w-[66px] shrink-0 items-center justify-center border-l border-[#242424] text-[#a1a1aa] transition-colors hover:bg-[#161616] hover:text-white"
        >
          <span className="grid grid-cols-2 gap-[3px]">
            <span className="h-[5px] w-[5px] rounded-[1px] bg-current" />
            <span className="h-[5px] w-[5px] rounded-[1px] bg-current" />
            <span className="h-[5px] w-[5px] rounded-[1px] bg-current" />
            <span className="h-[5px] w-[5px] rounded-[1px] bg-current" />
          </span>
        </Link>
      </div>
    </section>
  );
}
