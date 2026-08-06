"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Image from "next/image";

export default function Home() {
  const router = useRouter();
  const [symbol, setSymbol] = useState("");
  return (
    <main className="min-h-screen bg-black text-white">
      {/* Navbar */}
      <nav className="flex justify-between items-center px-8 py-5 border-b border-gray-800">
        <h1 className="text-3xl font-bold text-green-500">
          StockSphere
        </h1>

        <div className="flex gap-8 text-gray-300">
          <button>Markets</button>
          <button>Watchlist</button>
          <button>Portfolio</button>
          <button>Login</button>
        </div>
      </nav>

      {/* Hero */}
<section className="text-center mt-10">

  <div className="flex justify-center mb-8">
    <Image
  src="/stocksphere-logo.png"
  alt="StockSphere Logo"
  width={350}
  height={350}
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
      </section>

      {/* Market Cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-6 px-10 mt-24">
        <div className="bg-gray-900 p-6 rounded-xl">
          <h3>NIFTY 50</h3>
          <p className="text-green-500 text-xl">+0.82%</p>
        </div>

        <div className="bg-gray-900 p-6 rounded-xl">
          <h3>SENSEX</h3>
          <p className="text-green-500 text-xl">+0.74%</p>
        </div>

        <div className="bg-gray-900 p-6 rounded-xl">
          <h3>NASDAQ</h3>
          <p className="text-green-500 text-xl">+1.12%</p>
        </div>

        <div className="bg-gray-900 p-6 rounded-xl">
          <h3>GOLD</h3>
          <p className="text-red-500 text-xl">-0.15%</p>
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
    </main>
  );
}