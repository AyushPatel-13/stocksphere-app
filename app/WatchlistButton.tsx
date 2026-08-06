"use client";

import { useEffect, useState } from "react";
import {
  addToWatchlist,
  removeFromWatchlist,
  isInWatchlist,
} from "@/lib/watchlist";

export default function WatchlistButton({
  symbol,
}: {
  symbol: string;
}) {
  const [added, setAdded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkWatchlist() {
      const exists = await isInWatchlist(symbol);
      setAdded(exists);
      setLoading(false);
    }

    checkWatchlist();
  }, [symbol]);

  const handleClick = async () => {
    setLoading(true);

    if (added) {
      await removeFromWatchlist(symbol);
      setAdded(false);
    } else {
      await addToWatchlist(symbol);
      setAdded(true);
    }

    setLoading(false);
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{
        background: added ? "#2563eb" : "#22c55e",
        color: "white",
        border: "none",
        padding: "10px 20px",
        borderRadius: "8px",
        cursor: "pointer",
        marginTop: "10px",
      }}
    >
      {loading
        ? "Loading..."
        : added
        ? "✅ Added to Watchlist"
        : "⭐ Add to Watchlist"}
    </button>
  );
}