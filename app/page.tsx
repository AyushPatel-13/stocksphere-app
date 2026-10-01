"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect, type ReactNode } from "react";
import {
  getRecentlyViewed,
  type RecentlyViewedAsset,
} from "@/lib/utils/recentlyViewed";
import Image from "next/image";
import { stocks } from "../lib/stocks";
import HomeStats from "./HomeStats";
import AgentHome from "@/components/Agent/AgentHome";

/**
 * One figure in the US market row: a small label over the provider's price and
 * its change for the session.
 *
 * Presentation only — every number comes from `/api/market`. `loading` means
 * the request has not settled yet and draws a placeholder, so a pending fetch
 * never reads as missing data; a quote that came back null says Unavailable.
 */
function QuoteCard({
  label,
  quote,
  loading,
}: {
  label: string;
  quote: { price: number; changePercent?: number } | null;
  loading: boolean;
}) {
  const changePercent = quote?.changePercent;

  return (
    <div className="rounded-2xl border border-[#222] bg-[#111] p-5 transition-colors hover:border-[#2e2e2e]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#777]">
        {label}
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
    </div>
  );
}

/**
 * One row in a movers or market-direction list.
 *
 * `tone` is the only difference between the four lists that use this: the
 * advancing ones prefix a "+" and render green, the declining ones keep the
 * number's own minus sign and render red. The figure itself is the provider's.
 */
function MoveRow({
  symbol,
  price,
  changePercent,
  tone,
  onSelect,
}: {
  symbol: string;
  price: number;
  changePercent?: number;
  tone: "up" | "down";
  onSelect: () => void;
}) {
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        // A link's activation key is Enter. Space is deliberately left to its
        // default (page scroll) so a focused row can never navigate by
        // accident while someone is scrolling the page.
        if (e.key === "Enter") {
          e.preventDefault();
          onSelect();
        }
      }}
      className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-[#1a1a1a] p-4 transition-colors hover:bg-[#242424] focus-visible:bg-[#242424] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-500/40"
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
    </div>
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
  const router = useRouter();
  const [symbol, setSymbol] = useState("");
  const filteredStocks =
  symbol.length > 0
    ? stocks.filter(
        (stock) =>
          stock.symbol
            .toLowerCase()
            .includes(
              symbol.toLowerCase()
            ) ||
          stock.name
            .toLowerCase()
            .includes(
              symbol.toLowerCase()
            )
      )
    : [];

const [trendingStocks, setTrendingStocks] =
  useState<any[]>([]);

const [topPredictors, setTopPredictors] =
  useState<any[]>([]);

const [events, setEvents] =
  useState<any[]>([]);

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

const [recentlyViewed, setRecentlyViewed] =
  useState<RecentlyViewedAsset[]>([]);

useEffect(() => {
  setRecentlyViewed(getRecentlyViewed());

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

  // Trending Stocks

  const stockSymbols = [
    "AAPL",
    "TSLA",
    "NVDA",
    "MSFT",
    "RELIANCE",
    "TCS",
    "INFY",
    "HDFCBANK",
  ];

  const trendingData =
    stockSymbols.map((symbol) => {
      const discussions =
        JSON.parse(
          localStorage.getItem(
            `stockDiscussions_${symbol}`
          ) || "[]"
        );

      return {
        symbol,
        count: discussions.length,
      };
    });

  trendingData.sort(
    (a, b) => b.count - a.count
  );

  setTrendingStocks(
    trendingData.slice(0, 3)
  );

  // Events

  const savedEvents =
    JSON.parse(
      localStorage.getItem(
        "events"
      ) || "[]"
    );

  setEvents(
    savedEvents.slice(0, 3)
  );

  // Leaderboard

  const predictions =
    JSON.parse(
      localStorage.getItem(
        "predictions"
      ) || "[]"
    );

  const users: any = {};

  predictions.forEach(
    (prediction: any) => {
      const username =
        prediction.username;

      if (!users[username]) {
        users[username] = {
          username,
          predictions: 0,
          correct: 0,
        };
      }

      users[username]
        .predictions += 1;

      if (
        prediction.status ===
        "Correct"
      ) {
        users[username]
          .correct += 1;
      }
    }
  );

  const leaders =
    Object.values(users)
      .map((user: any) => ({
        ...user,
        accuracy:
          user.predictions > 0
            ? (
                (user.correct /
                  user.predictions) *
                100
              ).toFixed(1)
            : "0",
      }))
      .sort(
        (a: any, b: any) =>
          Number(b.accuracy) -
          Number(a.accuracy)
      );

  setTopPredictors(
    leaders.slice(0, 3)
  );

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

    {/* Search */}
    <div className="relative mx-auto mt-8 max-w-2xl">

      <input
        type="text"
        role="combobox"
        aria-expanded={symbol.trim().length > 0}
        aria-controls="home-search-results"
        aria-autocomplete="list"
        placeholder="Search stocks, ETFs, crypto, indices..."
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && symbol.trim()) {
            router.push(
              `/stock/${symbol.toUpperCase()}`
            );
          }
        }}
        className="w-full rounded-2xl border border-[#222] bg-[#111] px-5 py-4 text-white outline-none transition-colors placeholder:text-[#666] focus:border-green-500 focus:ring-1 focus:ring-green-500"
      />

      {/* Search Results.
          Gated on a trimmed query rather than on there being matches, so a
          query with no hits can say so — while an empty (or whitespace-only)
          input still renders nothing at all. */}
      {symbol.trim().length > 0 && (
        <div
          id="home-search-results"
          role={filteredStocks.length > 0 ? "listbox" : undefined}
          aria-label={filteredStocks.length > 0 ? "Search results" : undefined}
          className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-[#222] bg-[#111] text-left shadow-2xl"
        >
          {filteredStocks.length > 0 ? (
            filteredStocks
              .slice(0, 5)
              .map((stock) => (
                <div
                  key={stock.symbol}
                  role="option"
                  aria-selected={false}
                  tabIndex={0}
                  onClick={() =>
                    router.push(
                      `/stock/${stock.symbol}`
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      // Same navigation target as the click handler.
                      e.preventDefault();
                      router.push(
                        `/stock/${stock.symbol}`
                      );
                    } else if (e.key === " ") {
                      // Space must not scroll the page or act on the row.
                      // role="option" has no Space activation, so the only
                      // thing to suppress here is the default scroll.
                      e.preventDefault();
                    }
                  }}
                  className="cursor-pointer border-b border-[#1e1e1e] px-5 py-4 transition-colors last:border-b-0 hover:bg-[#1a1a1a] focus-visible:bg-[#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-500/40"
                >
                  <div className="font-semibold text-white">
                    {stock.symbol}
                  </div>

                  <div className="mt-1 text-sm text-[#888]">
                    {stock.name}
                  </div>
                </div>
              ))
          ) : (
            <p
              role="status"
              className="px-5 py-4 text-sm text-[#888]"
            >
              No stocks found.
            </p>
          )}
        </div>
      )}

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
        <button
          key={item}
          onClick={() =>
            router.push(`/stock/${item}`)
          }
          className="rounded-full border border-[#222] bg-[#111] px-4 py-2 text-[#c9c9c9] transition-colors hover:border-green-500 hover:text-green-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
        >
          {item}
        </button>
      ))}

    </div>

  </div>
</section>

{/* The rest of the page sits in one centred shell so every section lines up
    with the portfolio and stock pages instead of running the full window. */}
<div className="mx-auto w-full max-w-[1080px] px-4 pb-24 sm:px-6 lg:px-8">

{/* Recently Viewed */}
{recentlyViewed.length > 0 && (
  <section className="mt-4">
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-[18px] font-semibold tracking-tight">
        Recently Viewed
      </h2>
    </div>

    <div className="flex gap-4 overflow-x-auto pb-2">
      {recentlyViewed.map((asset) => (
        <div
          key={`${asset.type}-${asset.symbol}`}
          onClick={() =>
            router.push(`/stock/${asset.symbol}`)
          }
          className="min-w-[190px] cursor-pointer rounded-2xl border border-[#222] bg-[#111] p-4 transition-colors hover:border-[#2e2e2e] hover:bg-[#161616]"
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white">
              {asset.symbol}
            </span>

            <span className="text-xs text-[#777]">
              {asset.market}
            </span>
          </div>

          <p className="mt-2 text-sm text-[#888]">
            {asset.type.toUpperCase()}
          </p>
        </div>
      ))}
    </div>
  </section>
)}

{/* US Markets */}
<section className="mt-14">
  <h2 className="text-[22px] sm:text-[26px] font-bold tracking-tight mb-5">
    US Markets
  </h2>

  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">

    <QuoteCard
      label="Apple"
      quote={marketData?.us?.apple ?? null}
      loading={marketData === null}
    />

    <QuoteCard
      label="Microsoft"
      quote={marketData?.us?.microsoft ?? null}
      loading={marketData === null}
    />

    <QuoteCard
      label="Tesla"
      quote={marketData?.us?.tesla ?? null}
      loading={marketData === null}
    />

    <QuoteCard
      label="NVIDIA"
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
              onSelect={() =>
                router.push(
                  `/stock/${stock.symbol}`
                )
              }
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
              onSelect={() =>
                router.push(
                  `/stock/${stock.symbol}`
                )
              }
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
                onSelect={() =>
                  router.push(
                    `/stock/${stock.symbol}`
                  )
                }
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
                onSelect={() =>
                  router.push(
                    `/stock/${stock.symbol}`
                  )
                }
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

  {/* The three cards that stood here were hardcoded placeholder headlines
      naming Apple, Tesla and NVIDIA announcements. They rendered in news
      cards and read as live headlines, which they were not.

      There is no market-wide news feed in StockSphere to replace them with:
      the only news path is per-symbol — lib/providers/news.ts fetchNews()
      routes Indian tickers to Upstox and global ones to Finnhub, and the
      stock page uses it for one ticker at a time. No such source is invented
      or stood up here, so the section keeps its heading and shows the
      unavailable state that already exists for exactly this case, rather
      than a placeholder that would read as news again. */}
  <UnavailableNote>
    No market-wide news feed is available yet.
  </UnavailableNote>
</section>

<HomeStats />

</div>

    </main>
  );
}