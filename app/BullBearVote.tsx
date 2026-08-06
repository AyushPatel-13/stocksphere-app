"use client";

import { useEffect, useState } from "react";

export default function BullBearVote({
  symbol,
}: {
  symbol: string;
}) {
  const [bull, setBull] = useState(0);
  const [bear, setBear] = useState(0);

  useEffect(() => {
    const saved = JSON.parse(
      localStorage.getItem(
        `votes_${symbol}`
      ) || '{"bull":0,"bear":0}'
    );

    setBull(saved.bull);
    setBear(saved.bear);
  }, [symbol]);

  const voteBull = () => {
    const updated = {
      bull: bull + 1,
      bear,
    };

    setBull(updated.bull);

    localStorage.setItem(
      `votes_${symbol}`,
      JSON.stringify(updated)
    );
  };

  const voteBear = () => {
    const updated = {
      bull,
      bear: bear + 1,
    };

    setBear(updated.bear);

    localStorage.setItem(
      `votes_${symbol}`,
      JSON.stringify(updated)
    );
  };

  const total = bull + bear;

  const bullPercent =
    total > 0
      ? ((bull / total) * 100).toFixed(0)
      : 0;

  const bearPercent =
    total > 0
      ? ((bear / total) * 100).toFixed(0)
      : 0;

  return (
    <div
      style={{
        marginTop: "30px",
        background: "#111",
        padding: "20px",
        borderRadius: "10px",
      }}
    >
      <h2>📊 Market Sentiment</h2>

      <div
        style={{
          display: "flex",
          gap: "15px",
          marginTop: "15px",
        }}
      >
        <button
          onClick={voteBull}
          style={{
            background: "#22c55e",
            color: "white",
            border: "none",
            padding: "12px 20px",
            borderRadius: "8px",
            cursor: "pointer",
          }}
        >
          👍 Bullish ({bull})
        </button>

        <button
          onClick={voteBear}
          style={{
            background: "#ef4444",
            color: "white",
            border: "none",
            padding: "12px 20px",
            borderRadius: "8px",
            cursor: "pointer",
          }}
        >
          👎 Bearish ({bear})
        </button>
      </div>

      <div style={{ marginTop: "15px" }}>
        <p>🐂 Bullish: {bullPercent}%</p>
        <p>🐻 Bearish: {bearPercent}%</p>
      </div>
    </div>
  );
}