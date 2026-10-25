"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import IndicesBar from "@/components/IndicesBar";
import { Change, StockAvatar, toneClass } from "@/components/Markets/StockBits";
import RecentlyViewed from "@/components/Markets/RecentlyViewed";
import {
  EmptyState,
  PageHeader,
  PageShell,
  Panel,
  SectionTitle,
  StatCard,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/Page";
import { listNotifications, type AppNotification } from "@/lib/alerts/client";
import { buildBriefing } from "@/lib/dashboard/briefing";
import { buildWatchtower, parseStoredSnapshots, rollSnapshots, type Snapshot, type WatchtowerItem } from "@/lib/dashboard/watchtower";
import { summariseHoldings, toHoldingView, type HoldingRow } from "@/lib/client/holdings";
import { formatMoney, formatPercent, useQuotes } from "@/lib/client/useQuotes";
import { marketSession, scheduledOpenButQuiet, type SessionStatus } from "@/lib/markets/session";
import { getPortfolio } from "@/lib/portfolio";
import { supabase } from "@/lib/supabase";
import { getWatchlist } from "@/lib/watchlist";

/**
 * Personal dashboard.
 *
 * Everything here is loaded live: indices from /api/indices, holdings and
 * watchlist prices from /api/market, NIFTY 50 movers from Upstox, IPOs from
 * Upstox and US earnings dates from Finnhub. A section whose source fails
 * says so; nothing falls back to example numbers.
 */

type Mover = {
  symbol: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  lastUpdated?: string;
};

type MoversData = {
  universe: string;
  advancing: number;
  declining: number;
  unchanged: number;
  gainers: Mover[];
  losers: Mover[];
};

type Ipo = {
  id: string;
  symbol: string | null;
  name: string;
  section: string;
  board: string;
  openDate: string | null;
  closeDate: string | null;
  priceBand: { low: number | null; high: number | null } | null;
};

type Earnings = { symbol: string; date: string; hour?: string | null };

type NewsItem = {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  publishedAt: string;
  symbols: string[];
};

type Load<T> = { status: "loading" } | { status: "error" } | { status: "ready"; data: T };

async function getJson<T>(url: string, pick: (json: Record<string, unknown>) => T): Promise<Load<T>> {
  try {
    const response = await fetch(url);
    const json = await response.json();
    if (!response.ok || json?.success === false) return { status: "error" };
    return { status: "ready", data: pick(json) };
  } catch {
    return { status: "error" };
  }
}

function SessionBadge({ status, quiet }: { status: SessionStatus; quiet: boolean }) {
  const name = status.market === "IN" ? "NSE" : "US";
  const open = status.scheduled === "open" && !quiet;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[#262626] bg-[#151515] px-3 py-1 text-xs text-[#bbb]">
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${open ? "bg-[#22c55e]" : "bg-[#666]"}`} />
      {name}: {quiet ? "No recent trades (holiday?)" : status.label}
      <span className="text-[#666]">· {status.localTime}</span>
    </span>
  );
}

function Unavailable({ what }: { what: string }) {
  return <p className="py-6 text-center text-sm text-[#777]">{what} is unavailable right now.</p>;
}

function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-[#171717] motion-reduce:animate-none" />
      ))}
    </div>
  );
}

function timeAgo(iso: string, now: number) {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

function formatAsOf(iso: string | undefined) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) + " IST";
}

function MoverList({ title, items }: { title: string; items: Mover[] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-[#777]">{title}</p>
      <ul className="divide-y divide-[#1c1c1c]">
        {items.slice(0, 5).map((m) => (
          <li key={m.symbol}>
            <Link href={`/stock/${m.symbol}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:text-[#22c55e]">
              <span className="font-medium">{m.symbol}</span>
              <span className="text-right">
                <span className="mr-2 tabular-nums text-[#ccc]">{formatMoney(m.price, "INR")}</span>
                <span className={`tabular-nums ${toneClass(m.changePercent)}`}>{formatPercent(m.changePercent)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PersonalDashboard() {
  const [name, setName] = useState("");
  const [lists, setLists] = useState<Load<{ watchlist: string[]; holdings: HoldingRow[] }>>({ status: "loading" });
  const [movers, setMovers] = useState<Load<MoversData>>({ status: "loading" });
  const [ipos, setIpos] = useState<Load<Ipo[]>>({ status: "loading" });
  const [earnings, setEarnings] = useState<Load<Earnings[]>>({ status: "loading" });
  const [news, setNews] = useState<Load<NewsItem[]>>({ status: "loading" });
  // NSE's latest F&O ban list. Optional: an unreachable NSE just leaves it out.
  const [foBan, setFoBan] = useState<{ tradeDate: string; securities: string[] } | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  // undefined until this visit's snapshot has been rolled; null = first visit.
  const [baseline, setBaseline] = useState<Snapshot | null | undefined>(undefined);
  const rolled = useRef(false);

  useEffect(() => {
    // The clock is read after mount (not during render) and ticks each minute
    // so the session badges stay right.
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);

    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      const meta = data.user?.user_metadata ?? {};
      setName(String(meta.full_name || meta.name || "").split(" ")[0]);
    });

    Promise.all([getWatchlist(), getPortfolio()])
      .then(([watch, holdings]) =>
        setLists({
          status: "ready",
          data: {
            watchlist: Array.from(new Set(watch.map((w) => String(w.symbol).toUpperCase()))),
            holdings: (holdings ?? []) as HoldingRow[],
          },
        })
      )
      .catch(() => setLists({ status: "error" }));

    listNotifications(30)
      .then((result) => {
        if (result.status === "ready") setNotifications(result.value);
      })
      .catch(() => {});

    getJson("/api/market/movers", (j) => j as unknown as MoversData).then(setMovers);
    getJson("/api/ipo", (j) => (j.ipos as Ipo[]) ?? []).then(setIpos);
    getJson("/api/events/earnings?days=7", (j) => (j.events as Earnings[]) ?? []).then(setEarnings);
    getJson("/api/fo-ban", (j) => ({ tradeDate: String(j.tradeDate), securities: (j.securities as string[]) ?? [] })).then((result) => {
      if (result.status === "ready") setFoBan(result.data);
    });
    Promise.all([
      getJson("/api/news?region=india", (j) => (j.items as NewsItem[]) ?? []),
      getJson("/api/news?region=us", (j) => (j.items as NewsItem[]) ?? []),
    ]).then(([india, us]) => {
      if (india.status !== "ready" && us.status !== "ready") return setNews({ status: "error" });
      const all = [...(india.status === "ready" ? india.data : []), ...(us.status === "ready" ? us.data : [])];
      setNews({ status: "ready", data: all });
    });

    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  const { watchlist, holdings, followed } = useMemo(() => {
    const watch = lists.status === "ready" ? lists.data.watchlist : [];
    const rows = lists.status === "ready" ? lists.data.holdings : [];
    return {
      watchlist: watch,
      holdings: rows,
      followed: Array.from(new Set([...watch, ...rows.map((h) => String(h.symbol).toUpperCase())])),
    };
  }, [lists]);
  const { loading: quotesLoading, quotes } = useQuotes(followed);

  const holdingViews = holdings.map((row) => toHoldingView(row, quotes[String(row.symbol).toUpperCase()] ?? null));
  const summary = summariseHoldings(holdingViews);

  const followedSet = new Set(followed.map((s) => s.replace(/\.(NS|BO|BSE)$/, "")));
  const myEarnings = earnings.status === "ready" ? earnings.data.filter((e) => followedSet.has(e.symbol.toUpperCase())) : [];
  const myNews =
    news.status === "ready"
      ? news.data
          .filter((n) => n.symbols?.some((s) => followedSet.has(s.toUpperCase())))
          .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      : [];
  const liveIpos = ipos.status === "ready" ? ipos.data.filter((i) => i.section === "open" || i.section === "upcoming") : [];
  const bannedSet = new Set((foBan?.securities ?? []).map((s) => s.toUpperCase()));
  const myBanned = foBan ? { tradeDate: foBan.tradeDate, symbols: Array.from(followedSet).filter((s) => bannedSet.has(s)) } : null;

  const moversData = movers.status === "ready" ? movers.data : null;
  const latestQuote = moversData
    ? Math.max(...[...moversData.gainers, ...moversData.losers].map((m) => Date.parse(m.lastUpdated ?? "")).filter(Number.isFinite))
    : null;
  const latestQuoteTime = latestQuote !== null && Number.isFinite(latestQuote) ? latestQuote : null;

  const briefing =
    lists.status === "ready" && !quotesLoading && movers.status !== "loading"
      ? buildBriefing(
          {
            breadth: moversData ? { universe: "NIFTY 50", advancing: moversData.advancing, declining: moversData.declining, unchanged: moversData.unchanged } : null,
            topGainer: moversData?.gainers[0] ?? null,
            topLoser: moversData?.losers[0] ?? null,
            watchlist: watchlist.map((symbol) => ({ symbol, changePercent: quotes[symbol]?.changePercent ?? null })),
            portfolio: summary.totals,
            unpricedHoldings: summary.unpriced,
            openIpos: liveIpos.filter((i) => i.section === "open").length,
            earningsThisWeek: myEarnings.map((e) => e.symbol),
            foBan: myBanned,
          },
          (amount, currency) => formatMoney(amount, currency)
        )
      : null;

  // "Since your last visit": prices from this member's previous visit, kept in
  // their own browser (a per-device convenience, never shared or sent anywhere).
  useEffect(() => {
    if (rolled.current || !userId || lists.status !== "ready" || quotesLoading) return;
    rolled.current = true;
    const key = `stocksphere.watchtower.v1.${userId}`;
    const prices: Record<string, number> = {};
    for (const [symbol, quote] of Object.entries(quotes)) if (quote) prices[symbol] = quote.price;
    const timer = setTimeout(() => {
      let stored = null;
      try {
        stored = parseStoredSnapshots(window.localStorage.getItem(key));
      } catch {}
      const { baseline: previous, next } = rollSnapshots(stored, Date.now(), prices);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      setBaseline(previous);
    }, 0);
    return () => clearTimeout(timer);
  }, [userId, lists.status, quotesLoading, quotes]);

  const watchtowerReady = lists.status === "ready" && !quotesLoading && news.status !== "loading" && earnings.status !== "loading" && ipos.status !== "loading" && now !== null && (baseline !== undefined || !userId);
  const watchtower: WatchtowerItem[] | null = watchtowerReady
    ? buildWatchtower(
        {
          now: now!,
          baseline: baseline ?? null,
          quotes: followed.flatMap((symbol) => {
            const q = quotes[symbol];
            return q ? [{ symbol, price: q.price, changePercent: q.changePercent, currency: q.currency }] : [];
          }),
          notifications,
          earnings: myEarnings,
          ipos: liveIpos,
          news: myNews,
          foBan: myBanned,
        },
        (amount, currency) => formatMoney(amount, currency)
      )
    : null;

  const isNewUser = lists.status === "ready" && followed.length === 0;
  const greeting = name ? `Welcome back, ${name}` : "Your dashboard";

  return (
    <PageShell>
      <PageHeader
        eyebrow="Dashboard"
        title={greeting}
        description="Your markets, holdings and watchlist in one place, with live prices."
        actions={
          now !== null ? (
            <div className="flex flex-col items-start gap-1.5 sm:items-end">
              <SessionBadge status={marketSession("IN", now)} quiet={scheduledOpenButQuiet(marketSession("IN", now), latestQuoteTime, now)} />
              <SessionBadge status={marketSession("US", now)} quiet={false} />
            </div>
          ) : undefined
        }
      />

      <IndicesBar />

      <SectionTitle aside={moversData ? `Prices as of ${formatAsOf(moversData.gainers[0]?.lastUpdated) ?? "latest session"}` : undefined}>
        Today&apos;s briefing
      </SectionTitle>
      <Panel>
        {briefing === null ? (
          <SkeletonRows rows={3} />
        ) : briefing.length ? (
          <ul className="space-y-2 text-[15px] leading-relaxed text-[#ddd]">
            {briefing.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="text-[#22c55e]">•</span>
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[#777]">Market data isn&apos;t available right now, so there&apos;s no briefing yet.</p>
        )}
        <p className="mt-4 text-xs text-[#666]">Built from the live data on this page. Not investment advice.</p>
      </Panel>

      {followed.length > 0 && (
        <>
          <SectionTitle aside={baseline ? `Since your last visit · ${timeAgo(new Date(baseline.at).toISOString(), now ?? baseline.at)}` : "Your alerts, moves, events and news"}>
            Watchtower
          </SectionTitle>
          <Panel className="p-0">
            {watchtower === null ? (
              <div className="p-5"><SkeletonRows rows={4} /></div>
            ) : watchtower.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-[#777]">
                Nothing notable on your stocks right now: no alerts, no big moves and no recent news or upcoming events.
              </p>
            ) : (
              <ul className="divide-y divide-[#1c1c1c]">
                {watchtower.map((item) => {
                  const icon = { alert: "🔔", move: "📈", event: "📅", news: "📰" }[item.kind];
                  const body = (
                    <>
                      <span aria-hidden="true" className="mt-0.5 text-base">{icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-[#e5e5e5] group-hover:text-[#22c55e]">
                          {item.title}
                          {item.isNew && <span className="ml-2 rounded-full bg-[#22c55e]/15 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-[#4ade80]">New</span>}
                        </span>
                        {(item.detail || item.at) && (
                          <span className="block text-xs text-[#777]">
                            {item.detail}
                            {item.at && now !== null && `${item.detail ? " · " : ""}${timeAgo(new Date(item.at).toISOString(), now)}`}
                          </span>
                        )}
                      </span>
                    </>
                  );
                  return (
                    <li key={item.id}>
                      {item.external ? (
                        <a href={item.href} target="_blank" rel="noopener noreferrer" className="group flex gap-3 px-5 py-3 hover:bg-[#151515]">{body}</a>
                      ) : (
                        <Link href={item.href} className="group flex gap-3 px-5 py-3 hover:bg-[#151515]">{body}</Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          {news.status === "error" && <p className="mt-2 text-xs text-[#888]">News couldn&apos;t be loaded, so it&apos;s missing from this feed.</p>}
        </>
      )}

      {isNewUser && (
        <div className="mt-8">
          <EmptyState
            icon="✨"
            title="Make this dashboard yours"
            description="Add stocks to your watchlist or record a holding, and this page will track their prices, news and earnings for you."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/explore" className={primaryButtonClass}>Find stocks</Link>
                <Link href="/portfolio" className={secondaryButtonClass}>Add a holding</Link>
              </div>
            }
          />
        </div>
      )}

      {holdings.length > 0 && (
        <>
          <SectionTitle aside={<Link href="/portfolio" className="hover:text-white">Open holdings →</Link>}>Your holdings</SectionTitle>
          {quotesLoading ? (
            <SkeletonRows rows={2} />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {summary.totals.flatMap((t) => [
                  <StatCard key={`${t.currency}-v`} label={`Current value (${t.currency})`} value={formatMoney(t.current, t.currency)} />,
                  <StatCard
                    key={`${t.currency}-p`}
                    label={`Total P/L (${t.currency})`}
                    value={`${formatMoney(t.pnl, t.currency, true)} (${formatPercent(t.pnlPercent)})`}
                    tone={t.pnl >= 0 ? "up" : "down"}
                  />,
                ])}
              </div>
              {summary.unpriced > 0 && (
                <p className="mt-3 text-xs text-[#888]">
                  {summary.unpriced} holding{summary.unpriced === 1 ? "" : "s"} couldn&apos;t be priced right now and {summary.unpriced === 1 ? "is" : "are"} left out of these totals.
                </p>
              )}
            </>
          )}
        </>
      )}

      {watchlist.length > 0 && (
        <>
          <SectionTitle aside={<Link href="/watchlist" className="hover:text-white">Open watchlist →</Link>}>Your watchlist</SectionTitle>
          <Panel className="p-0">
            <ul className="divide-y divide-[#1c1c1c]">
              {watchlist.slice(0, 8).map((symbol) => {
                const q = quotes[symbol];
                return (
                  <li key={symbol}>
                    <Link href={`/stock/${symbol}`} className="flex items-center gap-3 px-5 py-3 hover:bg-[#151515]">
                      <StockAvatar symbol={symbol} size={32} />
                      <span className="flex-1 font-medium">{symbol}</span>
                      {quotesLoading && q === undefined ? (
                        <span className="h-4 w-24 animate-pulse rounded bg-[#1b1b1b]" />
                      ) : q ? (
                        <span className="text-right text-sm">
                          <span className="mr-3 tabular-nums">{formatMoney(q.price, q.currency)}</span>
                          <Change change={q.change} percent={q.changePercent} />
                        </span>
                      ) : (
                        <span className="text-xs text-[#777]">Price unavailable</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {watchlist.length > 8 && (
              <p className="border-t border-[#1c1c1c] px-5 py-3 text-xs text-[#777]">+{watchlist.length - 8} more on your watchlist</p>
            )}
          </Panel>
        </>
      )}

      <SectionTitle aside="NIFTY 50 · Upstox">Biggest movers</SectionTitle>
      <Panel>
        {movers.status === "loading" ? (
          <SkeletonRows />
        ) : movers.status === "error" ? (
          <Unavailable what="NIFTY 50 market data" />
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            <MoverList title="Top gainers" items={movers.data.gainers} />
            <MoverList title="Top losers" items={movers.data.losers} />
          </div>
        )}
      </Panel>

      <div className="grid gap-x-6 lg:grid-cols-2">
        <div>
          <SectionTitle aside={<Link href="/ipo" className="hover:text-white">All IPOs →</Link>}>Open &amp; upcoming IPOs</SectionTitle>
          <Panel>
            {ipos.status === "loading" ? (
              <SkeletonRows rows={3} />
            ) : ipos.status === "error" ? (
              <Unavailable what="IPO data" />
            ) : liveIpos.length === 0 ? (
              <p className="py-6 text-center text-sm text-[#777]">No IPOs are open or announced right now.</p>
            ) : (
              <ul className="divide-y divide-[#1c1c1c]">
                {liveIpos.slice(0, 5).map((ipo) => (
                  <li key={ipo.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{ipo.name}</span>
                      <span className="text-xs text-[#777]">
                        {ipo.board === "sme" ? "SME · " : ""}
                        {ipo.openDate && ipo.closeDate ? `${ipo.openDate} → ${ipo.closeDate}` : "Dates not announced"}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${ipo.section === "open" ? "bg-[#22c55e]/15 text-[#4ade80]" : "bg-[#1c1c1c] text-[#aaa]"}`}>
                      {ipo.section === "open" ? "Open" : "Upcoming"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-[#666]">Source: Upstox. Dates in IST.</p>
          </Panel>
        </div>

        <div>
          <SectionTitle aside={<Link href="/events" className="hover:text-white">Events →</Link>}>Earnings this week</SectionTitle>
          <Panel>
            {earnings.status === "loading" ? (
              <SkeletonRows rows={3} />
            ) : earnings.status === "error" ? (
              <Unavailable what="The earnings calendar" />
            ) : myEarnings.length === 0 ? (
              <p className="py-6 text-center text-sm text-[#777]">
                {followed.length ? "None of the stocks you follow report in the next 7 days." : "Follow stocks to see their earnings dates here."}
              </p>
            ) : (
              <ul className="divide-y divide-[#1c1c1c]">
                {myEarnings.slice(0, 6).map((e) => (
                  <li key={`${e.symbol}-${e.date}`}>
                    <Link href={`/stock/${e.symbol}`} className="flex justify-between py-2.5 text-sm hover:text-[#22c55e]">
                      <span className="font-medium">{e.symbol}</span>
                      <span className="text-[#aaa]">{e.date}{e.hour === "bmo" ? " · before open" : e.hour === "amc" ? " · after close" : ""}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-[#666]">Source: Finnhub. US-listed companies only.</p>
          </Panel>
        </div>
      </div>

      <RecentlyViewed className="mt-10" />
    </PageShell>
  );
}
