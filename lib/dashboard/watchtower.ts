/**
 * Watchtower: one feed of what changed for the stocks a member follows.
 *
 * Built only from data the dashboard already loaded — triggered alerts, live
 * quotes, earnings dates, IPO dates and tagged news — plus a price snapshot
 * from the member's previous visit, kept in their own browser. Nothing is
 * estimated: an item whose data is missing is simply not produced.
 */

export type WatchtowerKind = "alert" | "move" | "event" | "news";

export type WatchtowerItem = {
  id: string;
  kind: WatchtowerKind;
  title: string;
  detail?: string;
  href: string;
  external?: boolean;
  /** When it happened (alerts, news) — absent for moves and future events. */
  at?: number;
  /** Happened since the previous visit. */
  isNew: boolean;
};

export type Snapshot = { at: number; prices: Record<string, number> };
export type StoredSnapshots = { baseline: Snapshot | null; current: Snapshot | null };

/** A visit closer than this to the last one continues it rather than starting a new one. */
export const SAME_VISIT_MS = 30 * 60_000;
export const DAY_MOVE_PCT = 3;
export const SINCE_VISIT_PCT = 2;

/**
 * Roll the stored snapshots forward for a new page load. Returns the baseline
 * to compare against ("your last visit") and what to store. Reloading within
 * 30 minutes keeps the same baseline, so a refresh doesn't wipe the changes.
 */
export function rollSnapshots(stored: StoredSnapshots | null, now: number, prices: Record<string, number>): {
  baseline: Snapshot | null;
  next: StoredSnapshots;
} {
  const current = stored?.current ?? null;
  const baseline = current && now - current.at > SAME_VISIT_MS ? current : (stored?.baseline ?? null);
  const merged = { ...(current && now - current.at <= SAME_VISIT_MS ? current.prices : {}), ...prices };
  return { baseline, next: { baseline, current: { at: now, prices: merged } } };
}

export function parseStoredSnapshots(raw: string | null): StoredSnapshots | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    const ok = (s: unknown): s is Snapshot =>
      !!s && typeof (s as Snapshot).at === "number" && typeof (s as Snapshot).prices === "object" && (s as Snapshot).prices !== null;
    return { baseline: ok(value?.baseline) ? value.baseline : null, current: ok(value?.current) ? value.current : null };
  } catch {
    return null;
  }
}

export type WatchtowerInput = {
  now: number;
  baseline: Snapshot | null;
  quotes: { symbol: string; price: number; changePercent: number | null; currency: string }[];
  notifications: { id: string; kind: string; title: string; body: string | null; link: string | null; createdAt: string }[];
  earnings: { symbol: string; date: string; hour?: string | null }[];
  ipos: { id: string; name: string; section: string; openDate: string | null; closeDate: string | null }[];
  news: { id: string; title: string; url: string; sourceName: string; publishedAt: string; symbols: string[] }[];
  /** The member's stocks on NSE's latest F&O ban list, and the trade date it's for. */
  foBan?: { tradeDate: string; symbols: string[] } | null;
};

const KIND_ORDER: Record<WatchtowerKind, number> = { alert: 0, move: 1, event: 2, news: 3 };
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;
/** Only links inside the app are followed from a notification. */
const safeLocal = (link: string | null) => (link && /^\/[A-Za-z0-9/_.%&=?-]*$/.test(link) ? link : "/alerts");

export function buildWatchtower(input: WatchtowerInput, formatMoney: (amount: number, currency: string) => string, limit = 12): WatchtowerItem[] {
  const since = input.baseline?.at ?? null;
  const recentCutoff = input.now - 3 * 86_400_000;
  const items: WatchtowerItem[] = [];

  for (const n of input.notifications) {
    const at = Date.parse(n.createdAt);
    if (!Number.isFinite(at) || at < Math.min(recentCutoff, since ?? Infinity)) continue;
    items.push({
      id: `alert:${n.id}`,
      kind: "alert",
      title: n.title,
      detail: n.body ?? undefined,
      href: safeLocal(n.link),
      at,
      isNew: since !== null && at > since,
    });
  }

  for (const q of input.quotes) {
    const before = input.baseline?.prices[q.symbol];
    if (before && before > 0) {
      const change = ((q.price - before) / before) * 100;
      if (Math.abs(change) >= SINCE_VISIT_PCT) {
        items.push({
          id: `visit:${q.symbol}`,
          kind: "move",
          title: `${q.symbol} is ${change >= 0 ? "up" : "down"} ${pct(change).slice(1)} since your last visit`,
          detail: `${formatMoney(before, q.currency)} → ${formatMoney(q.price, q.currency)}`,
          href: `/stock/${encodeURIComponent(q.symbol)}`,
          isNew: true,
        });
        continue;
      }
    }
    if (q.changePercent !== null && Math.abs(q.changePercent) >= DAY_MOVE_PCT) {
      items.push({
        id: `day:${q.symbol}`,
        kind: "move",
        title: `${q.symbol} ${q.changePercent >= 0 ? "rose" : "fell"} ${pct(q.changePercent).slice(1)} in the latest session`,
        detail: `Now ${formatMoney(q.price, q.currency)}`,
        href: `/stock/${encodeURIComponent(q.symbol)}`,
        isNew: false,
      });
    }
  }

  for (const e of input.earnings) {
    const when = e.hour === "bmo" ? " before the open" : e.hour === "amc" ? " after the close" : "";
    items.push({
      id: `earn:${e.symbol}:${e.date}`,
      kind: "event",
      title: `${e.symbol} reports earnings on ${e.date}${when}`,
      detail: "Date from Finnhub's earnings calendar",
      href: `/stock/${encodeURIComponent(e.symbol)}`,
      isNew: false,
    });
  }

  for (const symbol of input.foBan?.symbols ?? []) {
    items.push({
      id: `foban:${symbol}:${input.foBan!.tradeDate}`,
      kind: "event",
      title: `${symbol} is in the F&O ban for ${input.foBan!.tradeDate}`,
      detail: "NSE fo_secban.csv · no new F&O positions until it exits",
      href: `/stock/${encodeURIComponent(symbol)}`,
      isNew: false,
    });
  }

  for (const ipo of input.ipos) {
    if (ipo.section === "open" && ipo.closeDate) {
      items.push({ id: `ipo:${ipo.id}`, kind: "event", title: `${ipo.name} is open until ${ipo.closeDate}`, detail: "Upstox IPO data · IST", href: "/ipo", isNew: false });
    } else if (ipo.section === "upcoming" && ipo.openDate) {
      items.push({ id: `ipo:${ipo.id}`, kind: "event", title: `${ipo.name} opens on ${ipo.openDate}`, detail: "Upstox IPO data · IST", href: "/ipo", isNew: false });
    }
  }

  const seenTitles = new Set<string>();
  for (const n of input.news) {
    const at = Date.parse(n.publishedAt);
    const key = n.title.trim().toLowerCase();
    if (!Number.isFinite(at) || at < recentCutoff || seenTitles.has(key)) continue;
    seenTitles.add(key);
    items.push({
      id: `news:${n.id}`,
      kind: "news",
      title: n.title,
      detail: `${n.sourceName}${n.symbols.length ? ` · ${n.symbols.slice(0, 3).join(", ")}` : ""}`,
      href: n.url,
      external: true,
      at,
      isNew: since !== null && at > since,
    });
  }

  return items
    .sort((a, b) => Number(b.isNew) - Number(a.isNew) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (b.at ?? 0) - (a.at ?? 0))
    .slice(0, limit);
}
