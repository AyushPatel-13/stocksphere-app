/**
 * How the Notifications page arranges what it's given: by kind, unread
 * first or not, and under day headings. Pure, so the rules are tested
 * without a database. Safe in the browser.
 */

export type NotificationItem = { id: string; kind: string; title: string; body: string | null; link: string | null; createdAt: string; readAt: string | null };

/** The kinds the database allows, as members see them. An unknown kind falls under "Other". */
export const NOTIFICATION_KINDS = [
  { id: "price_alert", label: "Price alerts", icon: "🔔" },
  { id: "community", label: "Community", icon: "💬" },
  { id: "prediction", label: "Predictions", icon: "🎯" },
  { id: "system", label: "StockSphere", icon: "✦" },
] as const;

export type KindFilter = "all" | (typeof NOTIFICATION_KINDS)[number]["id"];

export function kindInfo(kind: string): { label: string; icon: string } {
  return NOTIFICATION_KINDS.find((k) => k.id === kind) ?? { label: "Other", icon: "•" };
}

export function filterNotifications<T extends NotificationItem>(items: T[], kind: KindFilter, unreadOnly: boolean): T[] {
  return items.filter((item) => (kind === "all" || item.kind === kind) && (!unreadOnly || item.readAt === null));
}

/** How many of each kind are unread, for the filter chips. Only kinds that have notifications are listed. */
export function kindCounts(items: NotificationItem[]): { id: KindFilter; label: string; total: number; unread: number }[] {
  const counts = NOTIFICATION_KINDS.map((k) => {
    const mine = items.filter((item) => item.kind === k.id);
    return { id: k.id as KindFilter, label: k.label, total: mine.length, unread: mine.filter((item) => item.readAt === null).length };
  }).filter((entry) => entry.total > 0);
  return [{ id: "all", label: "All", total: items.length, unread: items.filter((item) => item.readAt === null).length }, ...counts];
}

/**
 * Newest first, under "Today", "Yesterday" and "Earlier", by the viewer's
 * own calendar day (`offsetMinutes` is Date#getTimezoneOffset: minutes
 * behind UTC, so India is −330). Empty groups are left out, and an item
 * whose time can't be read goes under "Earlier" rather than being dropped.
 */
export function groupByDay<T extends NotificationItem>(items: T[], now: number, offsetMinutes: number): { label: "Today" | "Yesterday" | "Earlier"; items: T[] }[] {
  const day = (at: number) => Math.floor((at - offsetMinutes * 60_000) / 86_400_000);
  const today = day(now);
  const sorted = [...items].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  const groups: { label: "Today" | "Yesterday" | "Earlier"; items: T[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Earlier", items: [] },
  ];
  for (const item of sorted) {
    const at = Date.parse(item.createdAt);
    const age = Number.isFinite(at) ? today - day(at) : Infinity;
    groups[age <= 0 ? 0 : age === 1 ? 1 : 2].items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}

/** Only in-app paths are followed from a notification; anything else opens the Notifications page itself. */
export function safeNotificationLink(link: string | null): string {
  return typeof link === "string" && /^\/(?!\/)[\w\-./?=&%#:@+~]*$/.test(link) ? link : "/notifications";
}
