"use client";

import { useEffect, useState } from "react";

/**
 * The two votes carry the page's own sentiment palette — the tinted up/down
 * chip the quote header already uses for its change (.sp-change/.sp-up/
 * .sp-down) — so a vote reads as a sentiment rather than as a solid call to
 * action, and neither is white-on-green (1.9:1) or white-on-#ef4444 (3.6:1)
 * any more. The card and heading match the Company Overview card beside them.
 *
 * The counts, the localStorage keys and the increments are untouched.
 */
const BB_STYLES = `
.bb-vote {
  padding: 12px 20px;
  border: 1px solid transparent;
  border-radius: 10px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease, transform 150ms ease;
}
.bb-vote:active { transform: translateY(1px); }
.bb-vote:focus-visible {
  outline-offset: 2px;
}
.bb-vote-up {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.3);
  color: #4ade80;
}
.bb-vote-up:hover {
  background: rgba(34, 197, 94, 0.18);
  border-color: rgba(34, 197, 94, 0.45);
}
.bb-vote-up:focus-visible { outline: 2px solid #4ade80; }
.bb-vote-down {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
  color: #f87171;
}
.bb-vote-down:hover {
  background: rgba(239, 68, 68, 0.18);
  border-color: rgba(239, 68, 68, 0.45);
}
.bb-vote-down:focus-visible { outline: 2px solid #f87171; }
@media (prefers-reduced-motion: reduce) {
  .bb-vote { transition: none; }
}
`;

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
        border: "1px solid #222",
        padding: "24px",
        borderRadius: "16px",
      }}
    >
      <style>{BB_STYLES}</style>

      <h2
        style={{
          margin: 0,
          fontSize: "22px",
          fontWeight: 700,
          letterSpacing: "-0.01em",
        }}
      >
        📊 Market Sentiment
      </h2>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "15px",
          marginTop: "15px",
        }}
      >
        <button
          onClick={voteBull}
          className="bb-vote bb-vote-up"
        >
          👍 Bullish ({bull})
        </button>

        <button
          onClick={voteBear}
          className="bb-vote bb-vote-down"
        >
          👎 Bearish ({bear})
        </button>
      </div>

      <div style={{ marginTop: "15px" }}>
        <p style={{ color: "#4ade80" }}>
          🐂 Bullish: {bullPercent}%
        </p>
        <p style={{ color: "#f87171" }}>
          🐻 Bearish: {bearPercent}%
        </p>
      </div>
    </div>
  );
}
