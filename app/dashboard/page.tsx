"use client";

import { useEffect, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { getWatchlist } from "@/lib/watchlist";
import { getPortfolio } from "@/lib/portfolio";
import { supabase } from "@/lib/supabase";
import { getActivity } from "@/lib/activity";

import WelcomeCard from "@/components/Dashboard/WelcomeCard";
import QuickActions from "@/components/Dashboard/QuickActions";
import StatsGrid from "@/components/Dashboard/StatsGrid";
import TrendingStocks from "@/components/Dashboard/TrendingStocks";
import RecentSearches from "@/components/Dashboard/RecentSearches";
import RecentActivity from "@/components/Dashboard/RecentActivity";
import MarketOverview from "@/components/Dashboard/MarketOverview";

export default function DashboardPage() {
  const [watchlistCount, setWatchlistCount] = useState(0);
  const [holdingsCount, setHoldingsCount] = useState(0);
  const [portfolioValue, setPortfolioValue] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [username, setUsername] = useState("");
  useEffect(() => {
  const loadDashboard = async () => {
    try {
      const watchlist = await getWatchlist();
      const portfolio = await getPortfolio();
      const activity = await getActivity();

      setActivities(activity);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        setUsername(
          user.user_metadata.full_name || "Investor"
        );
      }

      const recent = JSON.parse(
  localStorage.getItem("recentSearches") ?? "[]"
);

      setRecentSearches(recent);
      setWatchlistCount(watchlist.length);
      setHoldingsCount(portfolio.length);

      const total = portfolio.reduce(
        (sum: number, holding: any) =>
          sum +
          Number(holding.quantity) *
            Number(holding.buy_price),
        0
      );

      setPortfolioValue(total);
    } catch (error) {
      console.error(error);
    }
  };

  loadDashboard();
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
        <h1>📊 Dashboard</h1>

        <WelcomeCard
          username={username}
          portfolioValue={portfolioValue}
          watchlistCount={watchlistCount}
          holdingsCount={holdingsCount}
        />


        <QuickActions />

        <StatsGrid
          watchlistCount={watchlistCount}
          holdingsCount={holdingsCount}
          portfolioValue={portfolioValue}
        />
        <TrendingStocks />

        <RecentSearches
          recentSearches={recentSearches}
        />

        <RecentActivity
          activities={activities}
        />

        <MarketOverview />

      </div>
    </AuthGuard>
  );
}