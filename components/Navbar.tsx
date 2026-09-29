"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

const navigation = [
  { label: "Markets", href: "/dashboard", icon: "📊" },
  { label: "Watchlist", href: "/watchlist", icon: "⭐" },
  { label: "Portfolio", href: "/portfolio", icon: "💼" },
  { label: "Community", href: "/community", icon: "🌍" },
  { label: "Predictions", href: "/predictions", icon: "🎯" },
  { label: "Trending", href: "/trending", icon: "🔥" },
  { label: "News", href: "/news", icon: "📰" },
  { label: "Screener", href: "/screener", icon: "📈" },
  { label: "Events", href: "/events", icon: "📅" },
  { label: "Heatmap", href: "/heatmap", icon: "🗺️" },
];

export default function Navbar() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const fullName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    "User";

  const avatarUrl =
    user?.user_metadata?.avatar_url ||
    user?.user_metadata?.picture ||
    null;

  return (
    <header className="sticky top-0 z-50 border-b border-gray-800 bg-black/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-6 px-5">

        {/* Logo */}
        <Link
          href="/"
          className="flex shrink-0 items-center gap-3"
        >
          <Image
            src="/stocksphere-logo.png"
            alt="StockSphere"
            width={42}
            height={42}
            className="rounded-lg"
          />

          <div className="hidden sm:block">
            <div className="text-lg font-bold tracking-tight text-white">
  Stock<span className="text-green-500">Sphere</span>
</div>

            <div className="text-[10px] text-gray-500">
              Where Investors Think Together
            </div>
          </div>
        </Link>

        {/* Navigation */}
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-hide">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-300 transition hover:bg-gray-900 hover:text-white"
            >
              <span className="text-sm">
                {item.icon}
              </span>

              <span>
                {item.label}
              </span>
            </Link>
          ))}
        </nav>

        {/* User */}
        <div className="flex shrink-0 items-center gap-3">

          {user ? (
            <>
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={fullName}
                  width={38}
                  height={38}
                  className="h-[38px] w-[38px] rounded-full border border-gray-700 object-cover"
                />
              ) : (
                <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-gray-700 bg-gray-900 font-semibold text-green-500">
                  {fullName.charAt(0).toUpperCase()}
                </div>
              )}

              <span className="hidden max-w-[120px] truncate text-sm font-semibold text-white lg:block">
                {fullName}
              </span>

              <button
                onClick={logout}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-400 transition hover:bg-red-500 hover:text-white"
              >
                Logout
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-green-400"
            >
              Login
            </Link>
          )}

        </div>
      </div>
    </header>
  );
}