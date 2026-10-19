"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { LiveIndex } from "@/lib/services/indices";
import { formatIndexChange, formatIndexValue } from "@/lib/utils/format";

type Category = "indian" | "global";

type PageState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      indices: LiveIndex[];
      unavailable: Category[];
      fetchedAt: string | null;
    };

const REFRESH_MS = 60_000;

const CATEGORY_LABELS: Record<Category, string> = {
  indian: "Indian",
  global: "Global",
};

/**
 * When the market last priced an index, in the viewer's time. Global markets
 * are often closed while India trades, so a Friday close must not look live.
 */
function formatAsOf(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "numeric", month: "short" }) +
        ", " +
        date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const GRID_COLUMNS =
  "grid grid-cols-[2.2fr_1.15fr_1.35fr_1.15fr_1.15fr_1.15fr_1.2fr] items-center";

function ChangeText({
  change,
  changePercent,
}: {
  change: number | null;
  changePercent: number | null;
}) {
  const text = formatIndexChange(change, changePercent);

  if (text === "—") {
    return <span className="text-[#666]">—</span>;
  }

  return (
    <span
      className={`font-medium ${
        (change ?? 0) >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
      }`}
    >
      {text}
    </span>
  );
}

function MarketIcon({ category }: { category: Category }) {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#292929] bg-[#151515] text-sm">
      {category === "indian" ? "🇮🇳" : "🌐"}
    </div>
  );
}

function StatusBadge({ state }: { state: PageState }) {
  if (state.status === "loading") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-[#777]">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#555]" />
        Loading market data…
      </span>
    );
  }

  if (state.status === "error" || state.unavailable.length === 2) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-[#777]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#ef4444]" />
        Market data unavailable
      </span>
    );
  }

  const time = state.fetchedAt
    ? new Date(state.fetchedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <span className="flex items-center gap-1.5 text-xs text-[#777]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
      {time ? `Updated ${time}` : "Market data"}
    </span>
  );
}

function TableMessage({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-[#666]">
      {children}
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, row) => (
        <div
          key={row}
          className={`${GRID_COLUMNS} border-b border-[#1d1d1d] px-5 py-3.5 last:border-b-0`}
          aria-hidden="true"
        >
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 animate-pulse rounded-lg bg-[#151515]" />
            <div className="h-3.5 w-28 animate-pulse rounded bg-[#1a1a1a]" />
          </div>
          {Array.from({ length: 6 }).map((__, cell) => (
            <div
              key={cell}
              className="h-3.5 w-20 animate-pulse rounded bg-[#1a1a1a]"
            />
          ))}
        </div>
      ))}
    </>
  );
}

export default function IndicesPage() {
  const [activeTab, setActiveTab] = useState<Category>("indian");
  const [state, setState] = useState<PageState>({ status: "loading" });

  // Bumped by "Try again" to re-run the loading effect from scratch.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/indices", { cache: "no-store" });
        const result = await response.json();

        if (cancelled) return;

        if (!result?.success || !Array.isArray(result.data)) {
          // A failed refresh keeps the last good table on screen.
          setState((previous) =>
            previous.status === "ready" ? previous : { status: "error" }
          );
          return;
        }

        setState({
          status: "ready",
          indices: result.data as LiveIndex[],
          unavailable: Array.isArray(result.unavailable)
            ? (result.unavailable as Category[])
            : [],
          fetchedAt:
            typeof result.fetchedAt === "string" ? result.fetchedAt : null,
        });
      } catch (error) {
        console.error("Failed to fetch indices:", error);

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
  }, [attempt]);

  function retry() {
    setState({ status: "loading" });
    setAttempt((count) => count + 1);
  }

  const activeIndices =
    state.status === "ready"
      ? state.indices.filter((index) => index.category === activeTab)
      : [];

  const activeUnavailable =
    state.status === "ready" && state.unavailable.includes(activeTab);

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto w-full max-w-[1280px] px-4 pb-20 pt-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="mb-2 flex items-center gap-3">
            <p className="text-sm font-semibold tracking-wide text-[#22c55e]">
              MARKET OVERVIEW
            </p>
            <span className="h-1 w-1 rounded-full bg-[#444]" />
            <StatusBadge state={state} />
          </div>

          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Indices & Markets
          </h1>

          <p className="mt-2 max-w-2xl text-sm text-[#888] sm:text-base">
            Track major Indian and global indices in one place. Indian indices
            are from Upstox, global indices from Yahoo Finance.
          </p>
        </div>

        {/* Indices table */}
        <section className="overflow-hidden rounded-2xl border border-[#242424] bg-[#0b0b0b] shadow-[0_0_40px_rgba(0,0,0,0.25)]">
          {/* Tabs */}
          <div
            className="flex border-b border-[#242424] bg-[#0d0d0d]"
            role="tablist"
          >
            {(["indian", "global"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={`relative px-6 py-4 text-sm font-semibold transition-colors ${
                  activeTab === tab
                    ? "text-[#22c55e]"
                    : "text-[#777] hover:text-white"
                }`}
              >
                {CATEGORY_LABELS[tab]} Indices
                {activeTab === tab && (
                  <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-[#22c55e]" />
                )}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              <div
                className={`${GRID_COLUMNS} border-b border-[#242424] px-5 py-3.5 text-[11px] font-medium uppercase tracking-wide text-[#666]`}
              >
                <span>Index Name</span>
                <span>Last Traded</span>
                <span>Day Change</span>
                <span>High</span>
                <span>Low</span>
                <span>Open</span>
                <span>Prev. Close</span>
              </div>

              {state.status === "loading" ? (
                <SkeletonRows />
              ) : state.status === "error" ? (
                <TableMessage>
                  <span>We couldn&apos;t load market data right now.</span>
                  <button
                    type="button"
                    onClick={retry}
                    className="rounded-lg border border-[#2a2a2a] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#161616]"
                  >
                    Try again
                  </button>
                </TableMessage>
              ) : activeUnavailable ? (
                <TableMessage>
                  {CATEGORY_LABELS[activeTab]} index data is currently
                  unavailable. Please check back shortly.
                </TableMessage>
              ) : (
                activeIndices.map((index) => (
                  <Link
                    key={index.symbol}
                    href={`/asset/index/${index.symbol}`}
                    className={`${GRID_COLUMNS} border-b border-[#1d1d1d] px-5 py-3.5 transition-colors last:border-b-0 hover:bg-[#101010]`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <MarketIcon category={index.category} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">
                          {index.name}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[#666]">
                          {index.symbol}
                          {index.lastUpdated && (
                            <> · as of {formatAsOf(index.lastUpdated)}</>
                          )}
                        </div>
                      </div>
                    </div>

                    <span className="text-sm font-medium text-[#e5e5e5]">
                      {index.price !== null ? (
                        formatIndexValue(index.price, index.category)
                      ) : (
                        <span className="text-[#666]">Unavailable</span>
                      )}
                    </span>

                    <span className="text-sm">
                      <ChangeText
                        change={index.change}
                        changePercent={index.changePercent}
                      />
                    </span>

                    <span className="text-sm text-[#aaa]">
                      {formatIndexValue(index.high, index.category)}
                    </span>
                    <span className="text-sm text-[#aaa]">
                      {formatIndexValue(index.low, index.category)}
                    </span>
                    <span className="text-sm text-[#aaa]">
                      {formatIndexValue(index.open, index.category)}
                    </span>
                    <span className="text-sm text-[#aaa]">
                      {formatIndexValue(index.previousClose, index.category)}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </section>

        {/* More markets */}
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold">More markets</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { href: "/etfs", icon: "📦", title: "ETFs", text: "Indian and US exchange-traded funds" },
              { href: "/crypto", icon: "₿", title: "Crypto", text: "Major coins in ₹ or $" },
              { href: "/bonds", icon: "🏛️", title: "Bonds", text: "US Treasury yields and Indian bond ETFs" },
            ].map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="group rounded-xl border border-[#242424] bg-[#0b0b0b] p-4 transition-colors hover:border-[#333] hover:bg-[#101010]"
              >
                <span className="text-xl" aria-hidden="true">{card.icon}</span>
                <p className="mt-2 font-semibold group-hover:text-[#22c55e]">{card.title} →</p>
                <p className="mt-1 text-xs text-[#777]">{card.text}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
