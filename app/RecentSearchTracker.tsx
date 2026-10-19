"use client";

import { useEffect } from "react";
import { addRecentlyViewed, marketForSymbol } from "@/lib/utils/recentlyViewed";

export default function RecentSearchTracker({
  symbol,
  name,
}: {
  symbol: string;
  name?: string;
}) {
  useEffect(() => {
    const clean = decodeURIComponent(symbol).trim().toUpperCase();
    if (!clean) return;

    addRecentlyViewed({
      symbol: clean,
      name: name || undefined,
      type: "stock",
      market: marketForSymbol(clean),
      viewedAt: Date.now(),
    });
  }, [symbol, name]);

  return null;
}
