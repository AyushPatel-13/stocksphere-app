"use client";

import { useEffect, useState } from "react";
import {
  addToWatchlist,
  removeFromWatchlist,
  isInWatchlist,
} from "@/lib/watchlist";

/**
 * The two states are the same pair the Watchlist page's own buttons use:
 * .wl-btn-primary for "not added", .wl-btn-remove for "added" — which is also
 * the action a click performs in that state.
 *
 * It used to be one inline style object: white text on #22c55e (1.9:1, where
 * the app's black-on-green is around 13:1), a #2563eb blue for the added state
 * that appears nowhere else in the app, an 8px radius against the app's 10px,
 * and no hover or focus-visible treatment at all.
 */
const WB_STYLES = `
.wb-btn {
  margin-top: 10px;
  padding: 10px 20px;
  border: 1px solid transparent;
  border-radius: 10px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease;
}
.wb-btn:active { transform: translateY(1px); }
.wb-btn:disabled { cursor: default; }
.wb-btn-primary {
  background: #22c55e;
  color: #000;
}
.wb-btn-primary:hover { background: #1ea34d; }
.wb-btn-primary:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 2px;
}
.wb-btn-remove {
  background: #1a1a1a;
  border-color: #2a2a2a;
  color: #f87171;
}
.wb-btn-remove:hover {
  background: #2a1414;
  border-color: #4a2020;
}
.wb-btn-remove:focus-visible {
  outline: 2px solid #f87171;
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .wb-btn { transition: none; }
}
`;

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
    <>
      <style>{WB_STYLES}</style>

      <button
        onClick={handleClick}
        disabled={loading}
        className={
          added ? "wb-btn wb-btn-remove" : "wb-btn wb-btn-primary"
        }
      >
        {loading
          ? "Loading..."
          : added
          ? "✅ Added to Watchlist"
          : "⭐ Add to Watchlist"}
      </button>
    </>
  );
}
