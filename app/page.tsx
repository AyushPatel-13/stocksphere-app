"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
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
  useState<any>(null);

useEffect(() => {
  fetch("/api/market")
    .then((res) => res.json())
    .then((data) =>
      setMarketData(data)
    );

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
<section className="text-center mt-10">

  <div className="flex justify-center mb-8">
    <Image
  src="/stocksphere-logo.png"
  alt="StockSphere Logo"
  width={200}
  height={200}
/>
  </div>
        <h2 className="text-6xl font-bold">
          One Place For
          <span className="text-green-500"> Every Market</span>
        </h2>

        <p className="text-gray-400 mt-6 text-xl">
          Stocks • ETFs • Commodities • Crypto • Global Markets
        </p>

        <input
  type="text"
  placeholder="Search any stock..."
  value={symbol}
  onChange={(e) => setSymbol(e.target.value)}
  onKeyDown={(e) => {
    if (e.key === "Enter" && symbol.trim()) {
      router.push(`/stock/${symbol.toUpperCase()}`);
    }
  }}
  className="mt-10 w-[600px] max-w-[90%] p-4 rounded-xl bg-gray-900 border border-gray-700"
/>
{filteredStocks.length > 0 && (
  <div
    className="
      w-[600px]
      max-w-[90%]
      mx-auto
      bg-gray-900
      rounded-xl
      mt-2
      overflow-hidden
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
            p-4
            border-b
            border-gray-700
            cursor-pointer
            hover:bg-gray-800
          "
        >
          <div>
            {stock.symbol}
          </div>

          <div className="text-sm text-gray-400">
            {stock.name}
          </div>
        </div>
      ))}
  </div>
)}

      </section>

      {/* Market Cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-6 px-10 mt-24">

  <div className="bg-gray-900 p-6 rounded-xl">
    <h3>APPLE</h3>
    <p className="text-green-500 text-xl">
      {marketData?.apple
        ? `$${marketData.apple.price.toFixed(2)}`
        : "--"}
    </p>
  </div>

  <div className="bg-gray-900 p-6 rounded-xl">
    <h3>MICROSOFT</h3>
    <p className="text-green-500 text-xl">
      {marketData?.microsoft
        ? `$${marketData.microsoft.price.toFixed(2)}`
        : "--"}
    </p>
  </div>

  <div className="bg-gray-900 p-6 rounded-xl">
    <h3>TESLA</h3>
    <p className="text-green-500 text-xl">
      {marketData?.tesla
        ? `$${marketData.tesla.price.toFixed(2)}`
        : "--"}
    </p>
  </div>

  <div className="bg-gray-900 p-6 rounded-xl">
    <h3>NVIDIA</h3>
    <p className="text-green-500 text-xl">
      {marketData?.nvidia
        ? `$${marketData.nvidia.price.toFixed(2)}`
        : "--"}
    </p>
  </div>

</section>
      <section className="px-10 mt-16">
  <h2 className="text-3xl font-bold mb-6">
    Top Gainers
  </h2>

  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

    <div
  onClick={() => router.push("/stock/BEL")}
  className="bg-gray-900 p-6 rounded-xl cursor-pointer hover:bg-gray-800"
>
  <h3>BEL</h3>
  <p className="text-green-500">+4.20%</p>
</div>

    <div
  onClick={() => router.push("/stock/HAL")}
  className="bg-gray-900 p-6 rounded-xl cursor-pointer hover:bg-gray-800"
>
  <h3>HAL</h3>
  <p className="text-green-500">+3.85%</p>
</div>

    <div
  onClick={() => router.push("/stock/TRENT")}
  className="bg-gray-900 p-6 rounded-xl cursor-pointer hover:bg-gray-800"
>
  <h3>TRENT</h3>
  <p className="text-green-500">+3.12%</p>
</div>

  </div>
</section>
<section className="px-10 mt-16">
  <h2 className="text-3xl font-bold mb-6">
    Top Losers
  </h2>

  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

    <div className="bg-gray-900 p-6 rounded-xl">
      <h3 className="text-xl font-bold">WIPRO</h3>
      <p className="text-red-500">-2.10%</p>
    </div>

    <div className="bg-gray-900 p-6 rounded-xl">
      <h3 className="text-xl font-bold">TATAMOTORS</h3>
      <p className="text-red-500">-1.85%</p>
    </div>

    <div className="bg-gray-900 p-6 rounded-xl">
      <h3 className="text-xl font-bold">HDFCLIFE</h3>
      <p className="text-red-500">-1.40%</p>
    </div>

  </div>
</section>
<section className="px-10 mt-16">
  <h2 className="text-3xl font-bold mb-6">
    Market Sentiment
  </h2>

  <div className="grid md:grid-cols-2 gap-6">

    <div className="bg-gray-900 p-6 rounded-xl">
      <h3 className="text-green-500 text-2xl mb-4">
        Most Bought
      </h3>

      <p>1. RELIANCE</p>
      <p>2. TCS</p>
      <p>3. HDFCBANK</p>
      <p>4. INFY</p>
      <p>5. ICICIBANK</p>
    </div>

    <div className="bg-gray-900 p-6 rounded-xl">
      <h3 className="text-red-500 text-2xl mb-4">
        Most Sold
      </h3>

      <p>1. WIPRO</p>
      <p>2. TATAMOTORS</p>
      <p>3. SBIN</p>
      <p>4. AXISBANK</p>
      <p>5. ADANIPORTS</p>
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