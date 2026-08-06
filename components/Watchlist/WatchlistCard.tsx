"use client";

import { useEffect, useState } from "react";

type Props = {
  symbol: string;
  onRemove: () => void;
};

const companyData: Record<
  string,
  {
    name: string;
    sector: string;
    exchange: string;
  }
> = {
  NVDA: {
    name: "NVIDIA Corporation",
    sector: "Technology",
    exchange: "NASDAQ",
  },
  AAPL: {
    name: "Apple Inc.",
    sector: "Technology",
    exchange: "NASDAQ",
  },
  MSFT: {
    name: "Microsoft Corporation",
    sector: "Technology",
    exchange: "NASDAQ",
  },
};

export default function WatchlistCard({
  symbol,
  onRemove,
}: Props) {

  const [hovered, setHovered] = useState(false);

  const [price, setPrice] = useState<number | null>(null);

  const info = companyData[symbol] ?? {
    name: symbol,
    sector: "Unknown",
    exchange: "-",
  };

  useEffect(() => {
  async function loadPrice() {
    try {
      const response = await fetch(
        `/api/market?symbol=${symbol}`
      );

      const data = await response.json();

      setPrice(data.price);
    } catch (err) {
      console.error(err);
    }
  }

  loadPrice();
}, [symbol]);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "#111",
        borderRadius: "18px",
        padding: "22px",
        border: hovered ? "1px solid #2563eb" : "1px solid #222",
        transition: "all 0.3s ease",
        transform: hovered
          ? "translateY(-8px)"
          : "translateY(0)",
        boxShadow: hovered
          ? "0 15px 35px rgba(37,99,235,0.35)"
          : "0 0 0 rgba(0,0,0,0)",
      }}
    >
      <div
        style={{
          width: "55px",
          height: "55px",
          borderRadius: "50%",
          background: "#2563eb",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          color: "white",
          fontSize: "22px",
          fontWeight: "bold",
          marginBottom: "15px",
        }}
      >
        {symbol[0]}
      </div>

      <h3>{info.name}</h3>

      <div
        style={{
          color: "#888",
          marginTop: "5px",
        }}
      >
        {symbol} • {info.exchange}
      </div>

      <h2
  style={{
    marginTop: "20px",
    color: "#22c55e",
  }}
>
  {price !== null
    ? `$${price.toFixed(2)}`
    : "Loading..."}
</h2>

      <p
        style={{
          color: "#16a34a",
        }}
      >
        ▲ Live Price Coming Soon
      </p>

      <p
        style={{
          marginTop: "20px",
          color: "#888",
        }}
      >
        {info.sector}
      </p>

      <button
        onClick={() =>
          (window.location.href = `/stock/${symbol}`)
        }
        style={{
          width: "100%",
          marginTop: "25px",
          padding: "12px",
          background: hovered ? "#1d4ed8" : "#2563eb",
          transition: "all 0.3s ease",
          transform: hovered ? "scale(1.02)" : "scale(1)",
          border: "none",
          borderRadius: "10px",
          color: "white",
          cursor: "pointer",
        }}
      >
        Open Stock →
      </button>

      <button
        onClick={onRemove}
        style={{
          width: "100%",
          marginTop: "10px",
          padding: "12px",
          background: hovered ? "#b91c1c" : "#dc2626",
          transition: "all 0.3s ease",
          transform: hovered ? "scale(1.02)" : "scale(1)",
          border: "none",
          borderRadius: "10px",
          color: "white",
          cursor: "pointer",
        }}
      >
        Remove
      </button>
    </div>
  );
}