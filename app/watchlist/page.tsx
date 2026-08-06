"use client";

import { useEffect, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { getWatchlist, removeFromWatchlist } from "@/lib/watchlist";
import WatchlistHeader from "@/components/Watchlist/WatchlistHeader";
import EmptyWatchlist from "@/components/Watchlist/EmptyWatchlist";
import WatchlistGrid from "@/components/Watchlist/WatchlistGrid";
import WatchlistCard from "@/components/Watchlist/WatchlistCard";

export default function WatchlistPage() {
  const [stocks, setStocks] = useState<string[]>([]);

  useEffect(() => {
    const fetchWatchlist = async () => {
      const saved = await getWatchlist();

      setStocks(saved.map((item: any) => item.symbol));
    };

    fetchWatchlist();
  }, []);

  return (
    <AuthGuard>
      <div
        style={{
          background: "#000",
          color: "white",
          minHeight: "100vh",
          padding: "40px",
        }}
      >
        <WatchlistHeader />

        {stocks.length === 0 ? (
          <EmptyWatchlist />
        ) : (
          <WatchlistGrid>
            {stocks.map((stock) => (
              <WatchlistCard
                key={stock}
                symbol={stock}
                onRemove={async () => {
                  await removeFromWatchlist(stock);

                  setStocks(
                    stocks.filter(
                      (item) => item !== stock
                    )
                  );
                }}
              />
            ))}
          </WatchlistGrid>
        )}
      </div>
    </AuthGuard>
  );
}