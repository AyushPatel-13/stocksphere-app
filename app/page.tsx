"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import {
  getRecentlyViewed,
  type RecentlyViewedAsset,
} from "@/lib/utils/recentlyViewed";
import Image from "next/image";
import { stocks } from "../lib/stocks";
import HomeStats from "./HomeStats";

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
    }
  })
  .catch((error) => {
    console.error(
      "Market movers fetch error:",
      error
    );
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
<section className="px-6 pt-14 pb-10 text-center">
  <div className="mx-auto max-w-5xl">

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
    <p className="mt-4 text-base md:text-lg text-gray-400">
      Explore stocks, ETFs, crypto, indices and global markets.
    </p>

    {/* Search */}
    <div className="relative mx-auto mt-8 max-w-2xl">

      <input
        type="text"
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
        className="
          w-full
          rounded-xl
          border
          border-gray-700
          bg-gray-900
          px-5
          py-4
          text-white
          outline-none
          placeholder:text-gray-500
          focus:border-green-500
          focus:ring-1
          focus:ring-green-500
        "
      />

      {/* Search Results */}
      {filteredStocks.length > 0 && (
        <div
          className="
            absolute
            left-0
            right-0
            top-full
            z-40
            mt-2
            overflow-hidden
            rounded-xl
            border
            border-gray-800
            bg-gray-900
            text-left
            shadow-2xl
          "
        >
          {filteredStocks
            .slice(0, 5)
            .map((stock) => (
              <div
                key={stock.symbol}
                onClick={() =>
                  router.push(
                    `/stock/${stock.symbol}`
                  )
                }
                className="
                  cursor-pointer
                  border-b
                  border-gray-800
                  px-5
                  py-4
                  transition
                  last:border-b-0
                  hover:bg-gray-800
                "
              >
                <div className="font-semibold text-white">
                  {stock.symbol}
                </div>

                <div className="mt-1 text-sm text-gray-400">
                  {stock.name}
                </div>
              </div>
            ))}
        </div>
      )}

    </div>

    {/* Trending */}
    <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-sm">

      <span className="mr-1 text-gray-500">
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
          className="
            rounded-full
            border
            border-gray-800
            bg-gray-900
            px-4
            py-2
            text-gray-300
            transition
            hover:border-green-500
            hover:text-green-500
          "
        >
          {item}
        </button>
      ))}

    </div>

  </div>
</section>

{/* Recently Viewed */}
{recentlyViewed.length > 0 && (
  <section className="px-10 mt-6">
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-xl font-semibold">
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
          className="
            min-w-[190px]
            cursor-pointer
            rounded-xl
            border
            border-gray-800
            bg-gray-900
            p-4
            transition
            hover:border-green-500
            hover:bg-gray-800
          "
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white">
              {asset.symbol}
            </span>

            <span className="text-xs text-gray-500">
              {asset.market}
            </span>
          </div>

          <p className="mt-2 text-sm text-gray-400">
            {asset.type.toUpperCase()}
          </p>
        </div>
      ))}
    </div>
  </section>
)}

{/* Market Cards */}
<section className="grid grid-cols-2 md:grid-cols-4 gap-6 px-10 mt-10">

  <div className="bg-gray-900 p-6 rounded-xl">
    <h3>APPLE</h3>
    <p className="text-green-500 text-xl">
      {marketData?.us?.apple
        ? `$${marketData.us.apple.price.toFixed(2)}`
        : "--"}
    </p>
  </div>

  <div className="bg-gray-900 p-6 rounded-xl">
    <h3>MICROSOFT</h3>
    <p className="text-green-500 text-xl">
      {marketData?.us?.microsoft
        ? `$${marketData.us.microsoft.price.toFixed(2)}`
        : "--"}
    </p>
  </div>

  <div className="bg-gray-900 p-6 rounded-xl">
    <h3>TESLA</h3>
    <p className="text-green-500 text-xl">
      {marketData?.us?.tesla
        ? `$${marketData.us.tesla.price.toFixed(2)}`
        : "--"}
    </p>
  </div>

  <div className="bg-gray-900 p-6 rounded-xl">
    <h3>NVIDIA</h3>
    <p className="text-green-500 text-xl">
      {marketData?.us?.nvidia
        ? `$${marketData.us.nvidia.price.toFixed(2)}`
        : "--"}
    </p>
  </div>

</section>
 {/* Market Movers */}
<section className="px-10 mt-16">
  <h2 className="text-3xl font-bold mb-6">
    Market Movers
  </h2>

  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

    {/* Top Gainers */}
    <div className="bg-gray-900 p-6 rounded-xl">
      <h3 className="text-green-500 text-2xl font-bold mb-5">
        Top Gainers
      </h3>

      <div className="space-y-4">
        {marketMovers?.gainers.map((stock) => (
          <div
            key={stock.symbol}
            onClick={() =>
              router.push(
                `/stock/${stock.symbol}`
              )
            }
            className="flex items-center justify-between p-4 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-700"
          >
            <div>
              <p className="font-bold">
                {stock.symbol}
              </p>

              <p className="text-gray-400 text-sm">
                ₹{stock.price.toFixed(2)}
              </p>
            </div>

            <p className="text-green-500 font-bold">
              +{stock.changePercent?.toFixed(2)}%
            </p>
          </div>
        ))}
      </div>
    </div>

    {/* Top Losers */}
    <div className="bg-gray-900 p-6 rounded-xl">
      <h3 className="text-red-500 text-2xl font-bold mb-5">
        Top Losers
      </h3>

      <div className="space-y-4">
        {marketMovers?.losers.map((stock) => (
          <div
            key={stock.symbol}
            onClick={() =>
              router.push(
                `/stock/${stock.symbol}`
              )
            }
            className="flex items-center justify-between p-4 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-700"
          >
            <div>
              <p className="font-bold">
                {stock.symbol}
              </p>

              <p className="text-gray-400 text-sm">
                ₹{stock.price.toFixed(2)}
              </p>
            </div>

            <p className="text-red-500 font-bold">
              {stock.changePercent?.toFixed(2)}%
            </p>
          </div>
        ))}
      </div>
    </div>

  </div>
</section>
{/* Market Direction */}
<section className="px-10 mt-16">
  <h2 className="text-3xl font-bold mb-6">
    Market Direction
  </h2>

  <div className="grid md:grid-cols-2 gap-6">

    {/* Bullish */}
    <div className="bg-gray-900 p-6 rounded-xl">
      <h3 className="text-green-500 text-2xl font-bold mb-5">
        Bullish
      </h3>

      <div className="space-y-3">
        {marketData?.india
          ?.filter(
            (stock) =>
              (stock.changePercent ?? 0) > 0
          )
          .sort(
            (a, b) =>
              (b.changePercent ?? 0) -
              (a.changePercent ?? 0)
          )
          .map((stock) => (
            <div
              key={stock.symbol}
              onClick={() =>
                router.push(
                  `/stock/${stock.symbol}`
                )
              }
              className="flex justify-between items-center p-4 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-700"
            >
              <div>
                <p className="font-bold">
                  {stock.symbol}
                </p>

                <p className="text-gray-400 text-sm">
                  ₹{stock.price.toFixed(2)}
                </p>
              </div>

              <p className="text-green-500 font-bold">
                +{stock.changePercent?.toFixed(2)}%
              </p>
            </div>
          ))}
      </div>
    </div>

    {/* Bearish */}
    <div className="bg-gray-900 p-6 rounded-xl">
      <h3 className="text-red-500 text-2xl font-bold mb-5">
        Bearish
      </h3>

      <div className="space-y-3">
        {marketData?.india
          ?.filter(
            (stock) =>
              (stock.changePercent ?? 0) < 0
          )
          .sort(
            (a, b) =>
              (a.changePercent ?? 0) -
              (b.changePercent ?? 0)
          )
          .map((stock) => (
            <div
              key={stock.symbol}
              onClick={() =>
                router.push(
                  `/stock/${stock.symbol}`
                )
              }
              className="flex justify-between items-center p-4 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-700"
            >
              <div>
                <p className="font-bold">
                  {stock.symbol}
                </p>

                <p className="text-gray-400 text-sm">
                  ₹{stock.price.toFixed(2)}
                </p>
              </div>

              <p className="text-red-500 font-bold">
                {stock.changePercent?.toFixed(2)}%
              </p>
            </div>
          ))}
      </div>
    </div>

  </div>
</section>

{/* Latest News */}
<section className="px-10 mt-16">
  <h2 className="text-3xl font-bold mb-6">
    📰 Latest News
  </h2>

  <div className="grid gap-4">
    <div className="bg-gray-900 p-5 rounded-xl">
      Apple launches new AI feature
    </div>

    <div className="bg-gray-900 p-5 rounded-xl">
      Tesla beats delivery expectations
    </div>

    <div className="bg-gray-900 p-5 rounded-xl">
      NVIDIA expands AI chip production
    </div>
  </div>
</section>

<HomeStats />

    </main>
  );
}