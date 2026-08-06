"use client";

import { useEffect } from "react";

export default function RecentSearchTracker({
  symbol,
}: {
  symbol: string;
}) {
  useEffect(() => {
    const existing = JSON.parse(
      localStorage.getItem("recentSearches") || "[]"
    );

    const updated = [
      symbol,
      ...existing.filter(
        (item: string) => item !== symbol
      ),
    ].slice(0, 5);

    localStorage.setItem(
      "recentSearches",
      JSON.stringify(updated)
    );
  }, [symbol]);

  return null;
}