"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

import AuthGuard from "@/components/AuthGuard";
import { PageShell, Panel, secondaryButtonClass } from "@/components/ui/Page";
import { signOutAndLeave } from "@/lib/auth/session";
import { useCommunityUser } from "@/lib/community/client";
import { supabase } from "@/lib/supabase";

const LINKS = [
  { href: "/portfolio", label: "Portfolio", icon: "💼", hint: "Your holdings and P/L" },
  { href: "/watchlist", label: "Watchlist", icon: "⭐", hint: "Stocks you're following" },
  { href: "/predictions", label: "Predictions", icon: "🎯", hint: "Your market calls" },
  { href: "/dashboard", label: "Dashboard", icon: "📊", hint: "Your activity at a glance" },
];

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const member = useCommunityUser();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });
  }, []);

  const name =
    user?.user_metadata?.full_name || user?.user_metadata?.name || "Investor";
  const avatar =
    user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null;

  return (
    <AuthGuard>
      <PageShell>
        {user && (
          <>
            <Panel className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element -- Google avatar host isn't configured for next/image
                <img
                  src={avatar}
                  alt=""
                  width={88}
                  height={88}
                  referrerPolicy="no-referrer"
                  className="h-[88px] w-[88px] rounded-full border border-[#2a2a2a] object-cover"
                />
              ) : (
                <div className="flex h-[88px] w-[88px] items-center justify-center rounded-full border border-[#2a2a2a] bg-[#151515] text-3xl font-bold text-[#22c55e]">
                  {name.charAt(0).toUpperCase()}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <h1 className="truncate text-2xl font-bold tracking-tight">{name}</h1>
                <p className="mt-1 truncate text-sm text-[#888]">{user.email}</p>
                {member.status === "ready" && (
                  <Link href={`/profile/${member.profile.username}`} className="mt-2 inline-block text-sm font-semibold text-[#22c55e] hover:text-[#4ade80]">
                    View your public profile @{member.profile.username} →
                  </Link>
                )}
              </div>

              <button
                type="button"
                onClick={signOutAndLeave}
                className={`${secondaryButtonClass} hover:border-red-500/40 hover:text-red-400`}
              >
                Sign out
              </button>
            </Panel>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="group flex items-center gap-4 rounded-2xl border border-[#222] bg-[#111] p-4 transition-colors hover:border-[#2f2f2f] hover:bg-[#141414]"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#262626] bg-[#151515] text-lg">
                    {link.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold group-hover:text-[#22c55e]">
                      {link.label}
                    </span>
                    <span className="block text-xs text-[#777]">{link.hint}</span>
                  </span>
                  <span aria-hidden="true" className="ml-auto text-[#555] group-hover:text-[#22c55e]">
                    →
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}
      </PageShell>
    </AuthGuard>
  );
}
