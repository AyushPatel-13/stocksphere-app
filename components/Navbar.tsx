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

/**
 * The navbar's own stylesheet.
 *
 * The nav strip carried `overflow-x-auto scrollbar-hide`, but `scrollbar-hide`
 * is not a Tailwind v4 utility and nothing in the app defines it, so it did
 * nothing — Chrome painted a native 15px horizontal scrollbar inside the navbar
 * at every width (measured at 390, 768 and 1440). That bare grey bar was the
 * only part of the navbar that did not look deliberate.
 *
 * Hiding it keeps the strip scrollable — the ten links need 1092px and only fit
 * above roughly 1650px — while dropping the stray chrome. It changes what the
 * strip looks like, not what it does.
 */
const NAVBAR_STYLES = `
.navbar-scroll {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.navbar-scroll::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
`;

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
    <header className="sticky top-0 z-50 border-b border-[#222] bg-black/95 backdrop-blur">
      <style>{NAVBAR_STYLES}</style>

      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-4 px-4 sm:gap-6 sm:px-5">

        {/* Logo */}
        <Link
          href="/"
          className="flex shrink-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
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

            <div className="text-[10px] text-[#777]">
              Where Investors Think Together
            </div>
          </div>
        </Link>

        {/* Navigation */}
        <nav className="navbar-scroll flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-[#c9c9c9] transition-colors hover:bg-[#1a1a1a] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
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
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">

          {user ? (
            <>
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={fullName}
                  width={38}
                  height={38}
                  className="h-[38px] w-[38px] rounded-full border border-[#222] object-cover"
                />
              ) : (
                <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-[#222] bg-[#111] font-semibold text-green-500">
                  {fullName.charAt(0).toUpperCase()}
                </div>
              )}

              <span className="hidden max-w-[120px] truncate text-sm font-semibold text-white lg:block">
                {fullName}
              </span>

              <button
                onClick={logout}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
              >
                Logout
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-green-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              Login
            </Link>
          )}

        </div>
      </div>
    </header>
  );
}