"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { unreadCount } from "@/lib/alerts/client";

const POLL_MS = 60_000;

/**
 * The navbar bell: unread notifications for the signed-in member, refreshed
 * every minute while the tab is visible. Hidden until notifications exist
 * (signed out, or the alerts database update not applied yet).
 */
export default function NotificationBell() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      unreadCount().then((value) => {
        if (!cancelled) setCount(value);
      });
    };

    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (count === null) return null;

  return (
    <Link
      href="/alerts#notifications"
      aria-label={count > 0 ? `${count} unread notifications` : "Notifications"}
      className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-[#2a2a2a] text-white hover:bg-[#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
    >
      <span aria-hidden="true">🔔</span>
      {count > 0 && (
        <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-[#22c55e] px-1 text-center text-[10px] font-bold leading-[18px] text-black">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
