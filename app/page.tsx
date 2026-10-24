"use client";

import Link from "next/link";
import { useState, useEffect, type ReactNode } from "react";
import RecentlyViewed from "@/components/Markets/RecentlyViewed";
import Image from "next/image";
import SearchBox from "@/components/Search/SearchBox";
import HomeStats from "./HomeStats";
import HomeNews from "@/components/Markets/HomeNews";
import AgentHome from "@/components/Agent/AgentHome";
import IndicesBar from "@/components/IndicesBar";

/**
 * One figure in the US market row: a small label over the provider's price and
 * its change for the session.
 *
 * Presentation only — every number comes from `/api/market`. `loading` means
 * the request has not settled yet and draws a placeholder, so a pending fetch
 * never reads as missing data; a quote that came back null says Unavailable.
 *
 * The whole card is one link to the stock's page. `symbol` is the bare ticker
 * /api/market prices under this label, which is what /stock/[symbol] takes.
 * It links whether or not a quote came back: the stock page fetches its own.
 */
function QuoteCard({
  label,
  symbol,
  quote,
  loading,
}: {
  label: string;
  symbol: string;
  quote: { price: number; changePercent?: number } | null;
  loading: boolean;
}) {
  const changePercent = quote?.changePercent;

  return (
    <Link
      href={`/stock/${symbol}`}
      className="block rounded-2xl border border-[#222] bg-[#111] p-5 transition-colors hover:border-[#2e2e2e] hover:bg-[#141414] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#777]">
        {label}
        <span className="sr-only"> ({symbol})</span>
      </p>

      {loading ? (
        <span className="mt-3 block h-7 w-24 animate-pulse rounded-md bg-[#1b1b1b] motion-reduce:animate-none" />
      ) : quote ? (
        <>
          <p className="mt-2 text-xl font-bold tabular-nums">
            ${quote.price.toFixed(2)}
          </p>

          {typeof changePercent === "number" ? (
            <p
              className={`mt-1 text-[13px] font-semibold tabular-nums ${
                changePercent >= 0 ? "text-[#4ade80]" : "text-[#f87171]"
              }`}
            >
              {changePercent >= 0 ? "+" : ""}
              {changePercent.toFixed(2)}%
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-[13px] font-medium text-[#8a8a8a]">
          Unavailable
        </p>
      )}
    </Link>
  );
}

/**
 * One row in a movers or market-direction list.
 *
 * `tone` is the only difference between the four lists that use this: the
 * advancing ones prefix a "+" and render green, the declining ones keep the
 * number's own minus sign and render red. The figure itself is the provider's.
 *
 * The row is a real link to /stock/[symbol] (the APIs answer bare NSE
 * symbols), so it can open in a new tab, prefetches and reads as a link.
 */
function MoveRow({
  symbol,
  price,
  changePercent,
  tone,
}: {
  symbol: string;
  price: number;
  changePercent?: number;
  tone: "up" | "down";
}) {
  return (
    <Link
      href={`/stock/${encodeURIComponent(symbol)}`}
      className="flex items-center justify-between gap-3 rounded-xl bg-[#1a1a1a] p-4 transition-colors hover:bg-[#242424] focus-visible:bg-[#242424] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-500/40"
    >
      <div className="min-w-0">
        <p className="truncate font-bold">{symbol}</p>

        <p className="mt-0.5 text-sm tabular-nums text-[#888]">
          ₹{price.toFixed(2)}
        </p>
      </div>

      <p
        className={`shrink-0 font-bold tabular-nums ${
          tone === "up" ? "text-[#4ade80]" : "text-[#f87171]"
        }`}
      >
        {tone === "up" ? "+" : ""}
        {changePercent?.toFixed(2)}%
      </p>
    </Link>
  );
}

/** Placeholder rows for a list whose request has not settled yet. */
function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <span
          key={index}
          className="block h-[68px] animate-pulse rounded-xl bg-[#1b1b1b] motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

/** The neutral "nothing to show here" line — never a placeholder zero. */
function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl bg-[#151515] p-4 text-sm text-[#888]">
      {children}
    </p>
  );
}

/**
 * The "we could not get this" line.
 *
 * Deliberately distinct from EmptyNote. That one means the request succeeded
 * and the list was simply empty; a failed request, or a success:false answer,
 * is neither empty nor still pending, and must not be dressed up as either.
 * The border and the #8a8a8a ink are the ones the US market cards already use
 * for an unavailable quote.
 */
function UnavailableNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-[#2a2a2a] bg-[#151515] p-4 text-sm text-[#8a8a8a]">
      {children}
    </p>
  );
}

export default function Home() {
  const [marketData, setMarketData] =
  useState<{
    success: boolean;
    us: {
      apple: {
        price: number;
        change?: number;
        changePercent?: number;
      } | null;
      microsoft: {
        price: number;
        change?: number;
        changePercent?: number;
      } | null;
      tesla: {
        price: number;
        change?: number;
        changePercent?: number;
      } | null;
      nvidia: {
        price: number;
        change?: number;
        changePercent?: number;
      } | null;
    };
    india: {
      symbol: string;
      price: number;
      change?: number;
      changePercent?: number;
    }[];
  } | null>(null);

  const [marketMovers, setMarketMovers] = useState<{
  gainers: {
    symbol: string;
    price: number;
    changePercent?: number;
  }[];
  losers: {
    symbol: string;
    price: number;
    changePercent?: number;
  }[];
} | null>(null);

  /**
   * Set when the movers request failed, or answered success:false.
   *
   * marketMovers stays null in both of those cases — the very same value it
   * holds while the request is still in flight — so this flag is the only
   * thing that tells the two apart. Without it the section renders its
   * skeleton forever whenever the movers request does not succeed.
   */
  const [moversUnavailable, setMoversUnavailable] = useState(false);

useEffect(() => {
  fetch("/api/market")
    .then((res) => res.json())
    .then((data) =>
      setMarketData(data)
    );

    fetch("/api/market/movers")
  .then((res) => res.json())
  .then((data) => {
    if (data.success) {
      setMarketMovers({
        gainers: data.gainers,
        losers: data.losers,
      });
    } else {
      // success:false is an answer, not a pending request. Clearing the flag
      // here is what stops the section from skeleton-loading forever.
      setMoversUnavailable(true);
    }
  })
  .catch((error) => {
    console.error(
      "Market movers fetch error:",
      error
    );
    // The request never completed, so there is no data to show and nothing
    // more is coming. Say so, rather than leaving the skeleton up.
    setMoversUnavailable(true);
  });

}, []);
  return (
    <main className="min-h-screen bg-black text-white">
      {/* Navbar */}

      {/* Hero */}
<section className="px-4 pt-12 pb-8 text-center sm:px-6 sm:pt-16 lg:px-8">

  {/* StockSphere AI. The agent's entry point sits directly under the navbar,
      at the right: an assistant available whenever it is wanted, rather than a
      section of the page. It is the same agent the Stock Page opens —
      components/Agent/AgentHome.tsx renders the shared AgentPanel over the
      shared useAgentChat hook and the shared POST /api/agent. Home has no
      selected stock, so no symbol is passed and none is invented: the panel,
      the hook and the API all already take a null symbol as their neutral
      mode, and the agent resolves one itself through resolve_symbol when the
      question names one.

      This row is a sibling of the hero's 1080px container rather than a child
      of it, and that placement is the point. The pill is meant to sit beside
      Login, and Login is in the navbar, whose box is max-w-[1600px] with
      px-4/sm:px-5 — not 1080. Inside the hero's container the row could not
      reach past 1080, so above ~1144px the pill's right edge stopped well
      short of the navbar's and it read as part of the hero instead of as the
      shortcut beside it. As a sibling it can cancel the section's padding
      (-mx-*) and reproduce the navbar's box exactly, so the two right edges
      coincide at every width.

      Vertically the -mt pulls the pill up into the section's own top padding
      so it hangs 16px under the navbar — at 390 that padding is pt-12 and at
      sm+ it is pt-16, hence -mt-8 against -mt-12 — and the mb then adds back
      exactly what the shorter pill no longer occupies. The row's block takes
      the same height it did before, so nothing below it moves: the logo, the
      headline and every section keep their existing positions. */}
  <div className="-mx-4 -mt-8 mb-[66px] sm:-mx-6 sm:-mt-12 sm:mb-[88px] lg:-mx-8">
    <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-5">
      <AgentHome />
    </div>
  </div>

  <div className="mx-auto w-full max-w-[1080px]">

    {/* Logo */}
    <div className="flex justify-center mb-6">
      <Image
        src="/stocksphere-logo.png"
        alt="StockSphere Logo"
        width={110}
        height={110}
        className="rounded-2xl"
      />
    </div>

    {/* Heading */}
    <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
  <span className="text-white">Invest. Track. </span>
  <span className="text-green-500">Understand. Discuss.</span>
</h1>

    {/* Subtitle */}
    <p className="mx-auto mt-4 max-w-2xl text-base text-[#888] md:text-lg">
      Explore stocks, ETFs, crypto, indices and global markets.
    </p>

    {/* Search: instrument autocomplete across Indian and US stocks, ETFs,
        indices, crypto and bonds (components/Search/SearchBox.tsx). It
        replaces a filter over a hardcoded list of 23 stocks. */}
    <div className="relative mx-auto mt-8 max-w-2xl">
      <SearchBox variant="hero" />
    </div>

    {/* Trending */}
    <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-sm">

      <span className="mr-1 text-[#777]">
        Trending
      </span>

      {[
        "RELIANCE",
        "TCS",
        "AAPL",
        "NVDA",
        "TSLA",
      ].map((item) => (
        <Link
          key={item}
          href={`/stock/${item}`}
          className="rounded-full border border-[#222] bg-[#111] px-4 py-2 text-[#c9c9c9] transition-colors hover:border-green-500 hover:text-green-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
        >
          {item}
        </Link>
      ))}

    </div>

  </div>
</section>

{/* Market Indices */}
<IndicesBar />

{/* The rest of the page sits in one centred shell so every section lines up
    with the portfolio and stock pages instead of running the full window. */}
<div className="mx-auto w-full max-w-[1080px] px-4 pb-24 sm:px-6 lg:px-8">

{/* Recently Viewed: live prices, Groww-style row. */}
<RecentlyViewed className="mt-4" />

{/* US Markets */}
<section className="mt-14">
  <h2 className="text-[22px] sm:text-[26px] font-bold tracking-tight mb-5">
    US Markets
  </h2>

  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">

    <QuoteCard
      label="Apple"
      symbol="AAPL"
      quote={marketData?.us?.apple ?? null}
      loading={marketData === null}
    />

    <QuoteCard
      label="Microsoft"
      symbol="MSFT"
      quote={marketData?.us?.microsoft ?? null}
      loading={marketData === null}
    />

    <QuoteCard
      label="Tesla"
      symbol="TSLA"
      quote={marketData?.us?.tesla ?? null}
      loading={marketData === null}
    />

    <QuoteCard
      label="NVIDIA"
      symbol="NVDA"
      quote={marketData?.us?.nvidia ?? null}
      loading={marketData === null}
    />

  </div>
</section>
{/* Market Movers */}
<section className="mt-14">
  <h2 className="text-[22px] sm:text-[26px] font-bold tracking-tight mb-5">
    Market Movers
  </h2>

  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">

    {/* Top Gainers */}
    <div className="rounded-2xl border border-[#222] bg-[#111] p-5 sm:p-6">
      <h3 className="text-[15px] font-semibold uppercase tracking-[0.06em] text-[#4ade80] mb-4">
        Top Gainers
      </h3>

      {/* Unavailable is checked first: it is the only state that is neither
          "still loading" nor "loaded and empty". */}
      {moversUnavailable ? (
        <UnavailableNote>
          Nifty 50 movers are unavailable right now.
        </UnavailableNote>
      ) : marketMovers === null ? (
        <ListSkeleton />
      ) : (marketMovers.gainers?.length ?? 0) > 0 ? (
        <div className="space-y-3">
          {marketMovers.gainers?.map((stock) => (
            <MoveRow
              key={stock.symbol}
              symbol={stock.symbol}
              price={stock.price}
              changePercent={stock.changePercent}
              tone="up"
            />
          ))}
        </div>
      ) : (
        <EmptyNote>
          No advancing Nifty 50 stocks right now.
        </EmptyNote>
      )}
    </div>

    {/* Top Losers */}
    <div className="rounded-2xl border border-[#222] bg-[#111] p-5 sm:p-6">
      <h3 className="text-[15px] font-semibold uppercase tracking-[0.06em] text-[#f87171] mb-4">
        Top Losers
      </h3>

      {/* Same precedence as Top Gainers. One request feeds both cards, so the
          two are always in the same state. */}
      {moversUnavailable ? (
        <UnavailableNote>
          Nifty 50 movers are unavailable right now.
        </UnavailableNote>
      ) : marketMovers === null ? (
        <ListSkeleton />
      ) : (marketMovers.losers?.length ?? 0) > 0 ? (
        <div className="space-y-3">
          {marketMovers.losers?.map((stock) => (
            <MoveRow
              key={stock.symbol}
              symbol={stock.symbol}
              price={stock.price}
              changePercent={stock.changePercent}
              tone="down"
            />
          ))}
        </div>
      ) : (
        <EmptyNote>
          No declining Nifty 50 stocks right now.
        </EmptyNote>
      )}
    </div>

  </div>
</section>
{/* Market Direction */}
<section className="mt-14">
  <h2 className="text-[22px] sm:text-[26px] font-bold tracking-tight mb-5">
    Market Direction
  </h2>

  <div className="grid md:grid-cols-2 gap-4 sm:gap-6">

    {/* Bullish */}
    <div className="rounded-2xl border border-[#222] bg-[#111] p-5 sm:p-6">
      <h3 className="text-[15px] font-semibold uppercase tracking-[0.06em] text-[#4ade80] mb-4">
        Bullish
      </h3>

      {(() => {
        const bullish = marketData?.india
          ?.filter(
            (stock) =>
              (stock.changePercent ?? 0) > 0
          )
          .sort(
            (a, b) =>
              (b.changePercent ?? 0) -
              (a.changePercent ?? 0)
          );

        if (marketData === null) {
          return <ListSkeleton />;
        }

        if (!bullish || bullish.length === 0) {
          return (
            <EmptyNote>
              No advancing Indian stocks right now.
            </EmptyNote>
          );
        }

        return (
          <div className="space-y-3">
            {bullish.map((stock) => (
              <MoveRow
                key={stock.symbol}
                symbol={stock.symbol}
                price={stock.price}
                changePercent={stock.changePercent}
                tone="up"
              />
            ))}
          </div>
        );
      })()}
    </div>

    {/* Bearish */}
    <div className="rounded-2xl border border-[#222] bg-[#111] p-5 sm:p-6">
      <h3 className="text-[15px] font-semibold uppercase tracking-[0.06em] text-[#f87171] mb-4">
        Bearish
      </h3>

      {(() => {
        const bearish = marketData?.india
          ?.filter(
            (stock) =>
              (stock.changePercent ?? 0) < 0
          )
          .sort(
            (a, b) =>
              (a.changePercent ?? 0) -
              (b.changePercent ?? 0)
          );

        if (marketData === null) {
          return <ListSkeleton />;
        }

        if (!bearish || bearish.length === 0) {
          return (
            <EmptyNote>
              No declining Indian stocks right now.
            </EmptyNote>
          );
        }

        return (
          <div className="space-y-3">
            {bearish.map((stock) => (
              <MoveRow
                key={stock.symbol}
                symbol={stock.symbol}
                price={stock.price}
                changePercent={stock.changePercent}
                tone="down"
              />
            ))}
          </div>
        );
      })()}
    </div>

  </div>
</section>

{/* Latest News */}
<section className="mt-14">
  <h2 className="text-[22px] sm:text-[26px] font-bold tracking-tight mb-5">
    📰 Latest News
  </h2>

  <HomeNews />
</section>

<HomeStats />

</div>

    </main>
  );
}