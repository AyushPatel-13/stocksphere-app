"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Navbar() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    location.reload();
  };

  return (
    <div
      style={{
        background: "#111",
        padding: "15px 30px",
        display: "flex",
        alignItems: "center",
        gap: "30px",
        color: "white",
        fontWeight: "bold",
      }}
    >
      <a href="/">🏠 Home</a>

      <a href="/dashboard">📊 Dashboard</a>

      <a href="/watchlist">⭐ Watchlist</a>

      <a href="/portfolio">💼 Portfolio</a>

      <a href="/community">🌍 Community</a>

      <a href="/predictions">🎯 Predictions</a>

      <a href="/trending">🔥 Trending</a>

      <a href="/leaderboard">🏆 Leaderboard</a>

      <a href="/news">📰 News</a>

      <a href="/screener">📊 Screener</a>

      <a href="/events">📅 Events</a>

      <a href="/heatmap">🗺️ Heatmap</a>

      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        {user ? (
          <>
            <img
              src={user.user_metadata.avatar_url}
              width={40}
              height={40}
              style={{
                borderRadius: "50%",
              }}
            />

            <span>
              {user.user_metadata.full_name}
            </span>

            <button
              onClick={logout}
              style={{
                background: "#ef4444",
                color: "white",
                border: "none",
                padding: "8px 14px",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              Logout
            </button>
          </>
        ) : (
          <a href="/login">
            Login
          </a>
        )}
      </div>
    </div>
  );
}