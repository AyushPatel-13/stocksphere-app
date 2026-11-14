"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import AuthGuard from "@/components/AuthGuard";
import { EmptyState, PageHeader, PageShell, secondaryButtonClass } from "@/components/ui/Page";
import { listNotifications, markAllRead, markRead, type AppNotification } from "@/lib/alerts/client";
import { filterNotifications, groupByDay, kindCounts, kindInfo, safeNotificationLink, type KindFilter } from "@/lib/alerts/notificationsView";
import { timeAgo } from "@/lib/community/client";

/**
 * Everything StockSphere has told the member: triggered price alerts,
 * replies, mentions, follows and reposts. Filter by kind or to unread, mark
 * one or all read. The bell in the navbar opens this page.
 */

type State = { status: "loading" } | { status: "error" } | { status: "ready"; items: AppNotification[]; at: number };

const PAGE = 100;

function Notifications() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [kind, setKind] = useState<KindFilter>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listNotifications(PAGE)
      .then((result) => {
        if (cancelled) return;
        setState(result.status === "ready" ? { status: "ready", items: result.value, at: Date.now() } : { status: "error" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const items = useMemo(() => (state.status === "ready" ? state.items : []), [state]);
  const counts = useMemo(() => kindCounts(items), [items]);
  const groups = useMemo(
    () => (state.status === "ready" ? groupByDay(filterNotifications(state.items, kind, unreadOnly), state.at, new Date(state.at).getTimezoneOffset()) : []),
    [state, kind, unreadOnly]
  );
  const unread = counts[0]?.unread ?? 0;

  const setRead = (ids: Set<string> | "all") =>
    setState((current) =>
      current.status === "ready"
        ? { ...current, items: current.items.map((n) => (n.readAt === null && (ids === "all" || ids.has(n.id)) ? { ...n, readAt: new Date().toISOString() } : n)) }
        : current
    );

  async function readAll() {
    setWorking(true);
    try {
      await markAllRead();
      setRead("all");
    } catch {
      // Left as it was; the button stays for another try.
    } finally {
      setWorking(false);
    }
  }

  // Opening a notification reads it. Not awaited: the navigation shouldn't wait on it.
  function open(n: AppNotification) {
    if (n.readAt !== null) return;
    setRead(new Set([n.id]));
    markRead(n.id).catch(() => {});
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Notifications"
        title="Notifications"
        description="Triggered price alerts, replies, mentions, follows and reposts."
        actions={
          <div className="flex flex-wrap gap-2">
            {unread > 0 && (
              <button type="button" onClick={readAll} disabled={working} className={`${secondaryButtonClass} disabled:opacity-50`}>
                {working ? "Marking…" : `Mark all read (${unread})`}
              </button>
            )}
            <Link href="/alerts" className={secondaryButtonClass}>
              Manage alerts →
            </Link>
          </div>
        }
      />

      {state.status === "loading" && (
        <div className="space-y-2" role="status" aria-label="Loading notifications">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-[#111] motion-reduce:animate-none" />
          ))}
        </div>
      )}

      {state.status === "error" && (
        <div className="rounded-2xl border border-[#222] bg-[#111] px-6 py-10 text-center">
          <p className="text-sm text-[#999]">Notifications couldn&apos;t be loaded right now.</p>
          <button
            type="button"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
            className={`${secondaryButtonClass} mt-3`}
          >
            Try again
          </button>
        </div>
      )}

      {state.status === "ready" && items.length === 0 && (
        <EmptyState
          icon="🔔"
          title="No notifications yet"
          description="When a price alert triggers, or someone replies to, mentions, follows or reposts you, it shows up here."
          action={
            <Link href="/alerts" className={secondaryButtonClass}>
              Set a price alert
            </Link>
          }
        />
      )}

      {state.status === "ready" && items.length > 0 && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Kind" className="flex flex-wrap gap-1.5">
              {counts.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={kind === entry.id}
                  onClick={() => setKind(entry.id)}
                  className={`min-h-9 rounded-full border px-3 text-[13px] font-medium ${
                    kind === entry.id ? "border-[#22c55e]/60 bg-[#22c55e]/10 text-white" : "border-[#2a2a2a] text-[#aaa] hover:text-white"
                  }`}
                >
                  {entry.label}
                  {entry.unread > 0 && <span className="ml-1.5 rounded-full bg-[#22c55e]/20 px-1.5 text-[11px] text-[#4ade80]">{entry.unread}</span>}
                </button>
              ))}
            </div>
            <label className="ml-auto inline-flex min-h-9 cursor-pointer items-center gap-2 text-[13px] text-[#bbb]">
              <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} className="h-4 w-4 accent-[#22c55e]" />
              Unread only
            </label>
          </div>

          {groups.length === 0 ? (
            <p className="rounded-2xl border border-[#222] bg-[#111] px-6 py-10 text-center text-sm text-[#999]">
              {unreadOnly ? "You're all caught up." : "Nothing of this kind yet."}
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.label} className="mb-6">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#777]">{group.label}</h2>
                <ul className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
                  {group.items.map((n) => {
                    const info = kindInfo(n.kind);
                    return (
                      <li key={n.id} className={`border-b border-[#1b1b1b] last:border-b-0 ${n.readAt ? "" : "bg-[#22c55e]/[0.05]"}`}>
                        <Link href={safeNotificationLink(n.link)} onClick={() => open(n)} className="flex gap-3 px-4 py-3.5 hover:bg-[#151515] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-green-500 sm:px-5">
                          <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#262626] bg-[#161616] text-sm">
                            {info.icon}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-white">
                              {!n.readAt && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#22c55e]" role="img" aria-label="Unread" />}
                              {n.title}
                            </span>
                            {n.body && <span className="mt-0.5 block text-[13px] text-[#999]">{n.body}</span>}
                            <span className="mt-1 block text-xs text-[#6f6f6f]">
                              {info.label} · {timeAgo(n.createdAt, state.at)}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}

          {items.length === PAGE && <p className="text-center text-xs text-[#777]">Showing your latest {PAGE} notifications.</p>}
        </>
      )}
    </PageShell>
  );
}

export default function NotificationsPage() {
  return (
    <AuthGuard>
      <Notifications />
    </AuthGuard>
  );
}
