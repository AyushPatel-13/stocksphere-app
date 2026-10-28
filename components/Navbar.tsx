"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { signOutAndLeave } from "@/lib/auth/session";
import SearchModal from "@/components/Search/SearchModal";
import NotificationBell from "@/components/NotificationBell";
import { navigation } from "@/components/navigation";
import { useCommunityUser } from "@/lib/community/client";
import { myProfileHref } from "@/lib/profileView";

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
  const pathname = usePathname();
  // The phone menu belongs to the page it was opened on: navigating closes it.
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === pathname;

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuPath(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });
  }, []);

  const logout = signOutAndLeave;
  // Your avatar and name open your public profile (or onboarding, until you pick a handle).
  const member = useCommunityUser();
  const profileHref = myProfileHref(member);

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
        <nav aria-label="Main" className="navbar-scroll hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto md:flex">
          {navigation.map((item) => {
            const active =
              pathname === item.href ||
              pathname.startsWith(`${item.href}/`);

            return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors hover:bg-[#1a1a1a] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 ${
                active ? "bg-[#161616] text-white" : "text-[#c9c9c9]"
              }`}
            >
              <span className="text-sm">
                {item.icon}
              </span>

              <span>
                {item.label}
              </span>
            </Link>
            );
          })}
        </nav>

        {/* Phones: the links live in a menu instead of a clipped strip. */}
        <div className="flex-1 md:hidden" />

        {/* User */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <SearchModal />

          {user && <NotificationBell />}

          {user ? (
            <>
              <Link
                href={profileHref}
                aria-label="Your profile"
                className="flex items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/60 sm:gap-3"
              >
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

                <span className="hidden max-w-[120px] truncate text-sm font-semibold text-white hover:text-green-400 lg:block">
                  {fullName}
                </span>
              </Link>

              <button
                onClick={logout}
                className="hidden rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 md:inline-block"
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

          <button
            type="button"
            onClick={() => setMenuPath(menuOpen ? null : pathname)}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#2a2a2a] text-white hover:bg-[#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 md:hidden"
          >
            <span aria-hidden="true" className="text-lg leading-none">{menuOpen ? "✕" : "☰"}</span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav id="mobile-menu" aria-label="Main" className="border-t border-[#222] bg-black px-4 pb-4 pt-3 md:hidden">
          <ul className="grid grid-cols-2 gap-1.5">
            {navigation.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMenuPath(null)}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-[#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 ${
                      active ? "bg-[#161616] text-white" : "text-[#c9c9c9]"
                    }`}
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          {user && (
            <Link
              href={profileHref}
              onClick={() => setMenuPath(null)}
              className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-[#222] py-2.5 text-sm font-semibold text-white hover:bg-[#1a1a1a]"
            >
              Your profile
            </Link>
          )}
          {user && (
            <button
              type="button"
              onClick={logout}
              className="mt-3 w-full rounded-lg border border-red-500/30 bg-red-500/10 py-2.5 text-sm font-semibold text-red-400 hover:bg-red-500 hover:text-white"
            >
              Logout
            </button>
          )}
        </nav>
      )}
    </header>
  );
}