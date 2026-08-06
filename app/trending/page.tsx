"use client";

import { useEffect, useState } from "react";

export default function TrendingPage() {
  const [trending, setTrending] = useState<any[]>([]);

  useEffect(() => {
    const stocks = [
      "AAPL",
      "TSLA",
      "NVDA",
      "MSFT",
      "RELIANCE",
      "TCS",
      "INFY",
      "HDFCBANK",
    ];

    const data = stocks.map((symbol) => {
      const discussions = JSON.parse(
        localStorage.getItem(
          `stockDiscussions_${symbol}`
        ) || "[]"
      );

      return {
        symbol,
        count: discussions.length,
      };
    });

    data.sort((a, b) => b.count - a.count);

    setTrending(data);
  }, []);

  return (
    <div
      style={{
        background: "#000",
        color: "white",
        minHeight: "100vh",
        padding: "40px",
      }}
    >
      <h1>🔥 Trending Stocks</h1>

      <div style={{ marginTop: "30px" }}>
        {trending.map((stock, index) => (
          <div
            key={stock.symbol}
            style={{
              background: "#111",
              padding: "20px",
              borderRadius: "10px",
              marginBottom: "15px",
            }}
          >
            <h2>
              #{index + 1} {stock.symbol}
            </h2>

            <p>
              💬 {stock.count} discussions
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}