"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import MarketsNav from "@/components/Markets/MarketsNav";
import RecentlyViewed from "@/components/Markets/RecentlyViewed";
import { Change, StockAvatar, absPercent, toneClass } from "@/components/Markets/StockBits";
import { PageShell, primaryButtonClass, secondaryButtonClass } from "@/components/ui/Page";
import { summariseHoldings, toHoldingView, type HoldingRow } from "@/lib/client/holdings";
import { useMarketOverview } from "@/lib/client/useMarketOverview";
import { formatMoney, formatVolume, useQuotes } from "@/lib/client/useQuotes";
import { getPortfolio } from "@/lib/portfolio";
import { supabase } from "@/lib/supabase";

/* ------------------------------------------------------------------ */
/* Popular stocks                                                      */
/* ------------------------------------------------------------------ */

function PopularStocks() {
  const overview = useMarketOverview();
  const india = overview.status === "ready" ? overview.quotes.filter((q) => q.market === "India").slice(0, 4) : [];

  return (
    <section>
      <h2 className="mb-4 text-xl font-semibold tracking-tight">Popular stocks</h2>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {overview.status === "loading" &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[172px] animate-pulse rounded-2xl border border-[#1f1f1f] bg-[#111]" />
          ))}

        {overview.status === "error" && (
          <p className="col-span-full rounded-2xl border border-[#222] bg-[#111] p-5 text-sm text-[#888]">
            Prices are unavailable right now.
          </p>
        )}

        {india.map((quote) => (
          <Link
            key={quote.symbol}
            href={`/stock/${quote.symbol}`}
            className="group flex flex-col rounded-2xl border border-[#222] bg-[#111] p-4 transition-colors hover:border-[#2f2f2f] hover:bg-[#141414]"
          >
            <StockAvatar symbol={quote.symbol} market="India" />
            <p className="mt-4 line-clamp-2 min-h-[2.5em] text-sm font-medium leading-tight text-[#e5e5e5] group-hover:text-white">
              {quote.name}
            </p>
            <p className="mt-3 font-semibold tabular-nums">{formatMoney(quote.price, quote.currency)}</p>
            <p className="mt-1 text-sm">
              <Change change={quote.change} percent={quote.changePercent} />
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Top movers                                                          */
/* ------------------------------------------------------------------ */

type MoverQuote = {
  symbol: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  currency: string;
};

type MoversView = "gainers" | "losers" | "active";

const MOVER_TABS: { id: MoversView; label: string }[] = [
  { id: "gainers", label: "Gainers" },
  { id: "losers", label: "Losers" },
  { id: "active", label: "Most active" },
];

const MOVERS_SHOWN = 8;

function TopMovers() {
  const [view, setView] = useState<MoversView>("gainers");
  const [state, setState] = useState<
    { status: "loading" } | { status: "error" } | { status: "ready"; quotes: MoverQuote[] }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch("/api/market/nifty50")
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setState(
          data?.success && Array.isArray(data.quotes)
            ? { status: "ready", quotes: data.quotes }
            : { status: "error" }
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    if (state.status !== "ready") return [];
    const quotes = state.quotes;

    if (view === "gainers") {
      return quotes
        .filter((q) => (q.changePercent ?? 0) > 0)
        .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))
        .slice(0, MOVERS_SHOWN);
    }
    if (view === "losers") {
      return quotes
        .filter((q) => (q.changePercent ?? 0) < 0)
        .sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0))
        .slice(0, MOVERS_SHOWN);
    }
    return quotes
      .filter((q) => (q.volume ?? 0) > 0)
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, MOVERS_SHOWN);
  }, [state, view]);

  return (
    <section className="mt-12">
      <h2 className="mb-4 text-xl font-semibold tracking-tight">Top movers today</h2>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {MOVER_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setView(tab.id)}
            aria-pressed={view === tab.id}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              view === tab.id
                ? "border-[#22c55e]/60 bg-[#22c55e]/10 text-white"
                : "border-[#2a2a2a] text-[#aaa] hover:border-[#3a3a3a] hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
        <span className="ml-auto rounded-full border border-[#2a2a2a] px-3 py-1.5 text-xs font-medium text-[#999]">
          NIFTY 50
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
        <table className="w-full text-sm">
          <thead className="border-b border-[#222] text-xs text-[#777]">
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-medium">Company</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Market price (1D)</th>
              <th scope="col" className="hidden px-4 py-3 text-right font-medium sm:table-cell">Volume</th>
            </tr>
          </thead>
          <tbody>
            {state.status === "loading" &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-[#1b1b1b] last:border-b-0">
                  <td className="px-4 py-4"><div className="h-9 w-40 animate-pulse rounded-lg bg-[#1a1a1a]" /></td>
                  <td className="px-4 py-4"><div className="ml-auto h-4 w-24 animate-pulse rounded bg-[#1a1a1a]" /></td>
                  <td className="hidden px-4 py-4 sm:table-cell"><div className="ml-auto h-4 w-20 animate-pulse rounded bg-[#1a1a1a]" /></td>
                </tr>
              ))}

            {state.status === "error" && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-sm text-[#888]">
                  Nifty 50 data is unavailable right now.
                </td>
              </tr>
            )}

            {state.status === "ready" && rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-sm text-[#888]">
                  {view === "gainers"
                    ? "No Nifty 50 stock is up today."
                    : view === "losers"
                      ? "No Nifty 50 stock is down today."
                      : "Volume data isn't available yet."}
                </td>
              </tr>
            )}

            {rows.map((quote) => (
              <tr key={quote.symbol} className="group border-b border-[#1b1b1b] transition-colors last:border-b-0 hover:bg-[#151515]">
                <td className="px-4 py-3">
                  <Link href={`/stock/${encodeURIComponent(quote.symbol)}`} className="flex items-center gap-3">
                    <StockAvatar symbol={quote.symbol} size={36} market="India" />
                    <span>
                      <span className="block font-semibold group-hover:text-[#22c55e]">{quote.symbol}</span>
                      <span className="block text-xs text-[#777]">NSE</span>
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="block font-medium tabular-nums">{formatMoney(quote.price, quote.currency)}</span>
                  <span className="block text-xs">
                    <Change change={quote.change} percent={quote.changePercent} />
                  </span>
                </td>
                <td className="hidden px-4 py-3 text-right tabular-nums text-[#ccc] sm:table-cell">
                  {formatVolume(quote.volume)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Your investments                                                    */
/* ------------------------------------------------------------------ */

function YourInvestments() {
  const [auth, setAuth] = useState<"loading" | "signed-out" | "signed-in">("loading");
  const [rows, setRows] = useState<HoldingRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    supabase.auth
      .getUser()
      .then(async ({ data }) => {
        if (cancelled) return;
        if (!data.user) {
          setAuth("signed-out");
          return;
        }
        const holdings = (await getPortfolio()) as HoldingRow[];
        if (cancelled) return;
        setRows(holdings);
        setAuth("signed-in");
      })
      .catch(() => {
        if (!cancelled) setAuth("signed-out");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const symbols = useMemo(() => rows.map((row) => row.symbol), [rows]);
  const { loading, quotes } = useQuotes(symbols);
  const views = rows.map((row) => toHoldingView(row, quotes[String(row.symbol).toUpperCase()] ?? null));
  const { totals, unpriced } = summariseHoldings(views);

  return (
    <section>
      <h2 className="mb-4 text-xl font-semibold tracking-tight">Your investments</h2>

      <div className="rounded-2xl border border-[#222] bg-[#111] p-5">
        {auth === "loading" && <div className="h-36 animate-pulse rounded-xl bg-[#161616]" />}

        {auth === "signed-out" && (
          <div className="py-4 text-center">
            <p className="font-semibold">Track your portfolio</p>
            <p className="mt-1 text-sm text-[#888]">Sign in to see your holdings, returns and watchlist here.</p>
            <Link href="/login" className={`${primaryButtonClass} mt-4`}>
              Sign in
            </Link>
          </div>
        )}

        {auth === "signed-in" && rows.length === 0 && (
          <div className="py-4 text-center">
            <p className="font-semibold">No holdings yet</p>
            <p className="mt-1 text-sm text-[#888]">Add the stocks you own to track their value and returns.</p>
            <Link href="/portfolio" className={`${primaryButtonClass} mt-4`}>
              Add a holding
            </Link>
          </div>
        )}

        {auth === "signed-in" && rows.length > 0 && (
          loading && totals.length === 0 ? (
            <div className="h-36 animate-pulse rounded-xl bg-[#161616]" />
          ) : unpriced > 0 ? (
            <div>
              <p className="text-sm text-[#888]">
                {unpriced === 1 ? "1 holding" : `${unpriced} holdings`} couldn&apos;t be priced right now, so
                totals are hidden rather than shown incomplete.
              </p>
              <Link href="/portfolio" className={`${secondaryButtonClass} mt-4`}>
                View holdings
              </Link>
            </div>
          ) : (
            <div className="space-y-6">
              {totals.map((total) => (
                <dl key={total.currency} className="space-y-3 text-sm">
                  <div>
                    <dt className="text-[#888]">Current</dt>
                    <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                      {formatMoney(total.current, total.currency)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#888]">1D returns</dt>
                    <dd className={`tabular-nums ${toneClass(total.dayChange)}`}>
                      {total.dayChange === null
                        ? "—"
                        : `${formatMoney(total.dayChange, total.currency, true)} (${absPercent(total.dayChangePercent)})`}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#888]">Total returns</dt>
                    <dd className={`tabular-nums ${toneClass(total.pnl)}`}>
                      {formatMoney(total.pnl, total.currency, true)} ({absPercent(total.pnlPercent)})
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#888]">Invested</dt>
                    <dd className="tabular-nums">{formatMoney(total.invested, total.currency)}</dd>
                  </div>
                </dl>
              ))}
            </div>
          )
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

const TOOLS = [
  { href: "/screener", icon: "📈", label: "Screener", hint: "Sort stocks by price and move" },
  { href: "/heatmap", icon: "🗺️", label: "Heatmap", hint: "Today's moves at a glance" },
  { href: "/indices", icon: "🌐", label: "Indices", hint: "Indian and global indices" },
  { href: "/predictions", icon: "🎯", label: "Predictions", hint: "Make and track market calls" },
];

function Tools() {
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-xl font-semibold tracking-tight">Tools</h2>
      <ul className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
        {TOOLS.map((tool) => (
          <li key={tool.href} className="border-b border-[#1d1d1d] last:border-b-0">
            <Link href={tool.href} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[#151515]">
              <span className="text-xl" aria-hidden="true">{tool.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium group-hover:text-[#22c55e]">{tool.label}</span>
                <span className="block text-xs text-[#777]">{tool.hint}</span>
              </span>
              <span aria-hidden="true" className="text-[#555] group-hover:text-[#22c55e]">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */

const MARKETS = [
  { href: "/screener", icon: "📈", label: "Stocks" },
  { href: "/indices", icon: "🌐", label: "Indices" },
  { href: "/etfs", icon: "📦", label: "ETFs" },
  { href: "/crypto", icon: "₿", label: "Crypto" },
  { href: "/bonds", icon: "🏛️", label: "Bonds" },
  { href: "/commodities", icon: "🛢️", label: "Commodities" },
];

/** Every asset class StockSphere covers, one tap away. */
function BrowseMarkets() {
  return (
    <nav aria-label="Browse markets" className="mb-10 grid grid-cols-3 gap-2 sm:grid-cols-6">
      {MARKETS.map((market) => (
        <Link
          key={market.href}
          href={market.href}
          className="group flex flex-col items-center gap-1.5 rounded-2xl border border-[#222] bg-[#111] px-2 py-3 text-center transition-colors hover:border-[#2f2f2f] hover:bg-[#141414]"
        >
          <span className="text-lg" aria-hidden="true">{market.icon}</span>
          <span className="text-xs font-medium text-[#ccc] group-hover:text-white sm:text-sm">{market.label}</span>
        </Link>
      ))}
    </nav>
  );
}

export default function ExplorePage() {
  return (
    <PageShell>
      <MarketsNav />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <BrowseMarkets />
          <RecentlyViewed className="mb-10" />
          <PopularStocks />
          <TopMovers />
        </div>

        <aside className="min-w-0">
          <YourInvestments />
          <Tools />
        </aside>
      </div>
    </PageShell>
  );
}
