"use client";

import { useEffect } from "react";
import { addRecentlyViewed } from "@/lib/utils/recentlyViewed";

export default function RecentSearchTracker({
  symbol,
}: {
  symbol: string;
}) {
  useEffect(() => {
    addRecentlyViewed({
      symbol,
      type: "stock",
      market: symbol.endsWith(".NS")
        ? "INDIA"
        : "US",
      viewedAt: Date.now(),
    });
  }, [symbol]);

  return null;
}