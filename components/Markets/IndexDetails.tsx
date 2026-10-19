"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { StockAvatar } from "@/components/Markets/StockBits";
import type { Candle } from "@/lib/apis/yahooChart";
import { formatCompactVolume, formatValue } from "@/lib/charts/format";
import { classicPivots, previousSession, type Pivots } from "@/lib/charts/pivots";
import type { AssetType, ValueUnit } from "@/lib/data/assets";
import type { IndexOverviewRow } from "@/lib/services/indexOverview";

/**
 * The detail sections under an asset's chart, in the layout of a broker app:
 * Performance (day and 52-week ranges), Support & Resistance (classic
 * pivots), the index's constituents, and every other index.
 */

const UP = "#00b386";
const DOWN = "#eb5b3c";

function SectionTitle({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className="mb-4 mt-10 flex items-baseline justify-between gap-3">
      <h2 className="text-xl font-semibold tracking-tight">{children}</h2>
      {note && <span className="text-xs text-[#666]">{note}</span>}
    </div>
  );
}

/* ------------------------------------------------------------ performance */

function RangeBar({ low, high, value }: { low: number | null; high: number | null; value: number | null }) {
  const position =
    low !== null && high !== null && value !== null && high > low
      ? Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100))
      : null;

  return (
    <div className="relative mx-4 h-6 flex-1 self-center" aria-hidden="true">
      <div className="absolute inset-x-0 top-1.5 h-1 rounded-full" style={{ background: `linear-gradient(90deg, ${DOWN}, #e5c13a, ${UP})` }} />
      {position !== null && (
        <span
          className="absolute top-3 -translate-x-1/2 border-x-[6px] border-b-[8px] border-x-transparent border-b-[#d4d4d4]"
          style={{ left: `${position}%` }}
        />
      )}
    </div>
  );
}

export type DayStats = {
  unit: ValueUnit;
  currency: string | null;
  last: number | null;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
};

export function Performance({ stats }: { stats: DayStats | null | undefined }) {
  const fmt = (value: number | null | undefined) => (stats ? formatValue(value, stats.unit, stats.currency) : "—");

  const rows: { lowLabel: string; low: number | null; highLabel: string; high: number | null; sideLabel: string; side: number | null }[] = [
    { lowLabel: "Today's low", low: stats?.low ?? null, highLabel: "Today's high", high: stats?.high ?? null, sideLabel: "Open", side: stats?.open ?? null },
    { lowLabel: "52W low", low: stats?.fiftyTwoWeekLow ?? null, highLabel: "52W high", high: stats?.fiftyTwoWeekHigh ?? null, sideLabel: "Prev. close", side: stats?.previousClose ?? null },
  ];

  return (
    <section aria-labelledby="performance-title">
      <SectionTitle>
        <span id="performance-title">Performance</span>
      </SectionTitle>
      <div className="rounded-2xl border border-[#222] bg-[#0d0d0d] p-5">
        {stats === undefined ? (
          <div className="h-28 animate-pulse rounded-xl bg-[#141414]" />
        ) : (
          <div className="space-y-6">
            {rows.map((row) => (
              <div key={row.lowLabel} className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center">
                  <div className="shrink-0">
                    <p className="text-xs text-[#888]">{row.lowLabel}</p>
                    <p className="mt-1 font-semibold tabular-nums">{fmt(row.low)}</p>
                  </div>
                  <RangeBar low={row.low} high={row.high} value={stats?.last ?? null} />
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-[#888]">{row.highLabel}</p>
                    <p className="mt-1 font-semibold tabular-nums">{fmt(row.high)}</p>
                  </div>
                </div>
                <div className="sm:w-36 sm:border-l sm:border-[#222] sm:pl-5">
                  <p className="text-xs text-[#888]">{row.sideLabel}</p>
                  <p className="mt-1 font-semibold tabular-nums">{fmt(row.side)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ pivots */

export function SupportResistance({
  type,
  symbol,
  vs,
  last,
}: {
  type: AssetType;
  symbol: string;
  vs: string;
  last: number | null;
}) {
  const [state, setState] = useState<{ pivots: Pivots; unit: ValueUnit; currency: string | null } | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ type, symbol, range: "6mo", vs });

    fetch(`/api/history?${params.toString()}`)
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        const prev = data?.success ? previousSession(data.candles as Candle[], data.sessionStart ?? null) : null;
        setState(prev ? { pivots: classicPivots(prev.high, prev.low, prev.close), unit: data.unit, currency: data.currency } : null);
      })
      .catch(() => {
        if (!cancelled) setState(null);
      });

    return () => {
      cancelled = true;
    };
  }, [type, symbol, vs]);

  if (state === null) return null;

  const fmt = (value: number) => (state ? formatValue(value, state.unit, state.currency) : "—");
  const levels = state
    ? ([
        ["R3", state.pivots.r3],
        ["R2", state.pivots.r2],
        ["R1", state.pivots.r1],
        ["S1", state.pivots.s1],
        ["S2", state.pivots.s2],
        ["S3", state.pivots.s3],
      ] as const)
    : [];

  return (
    <section aria-labelledby="pivots-title">
      <SectionTitle note="Classic pivots from the previous session">
        <span id="pivots-title">Support and resistance</span>
      </SectionTitle>
      <div className="overflow-hidden rounded-2xl border border-[#222] bg-[#0d0d0d]">
        {state === undefined ? (
          <div className="h-64 animate-pulse bg-[#141414]" />
        ) : (
          <ul>
            {levels.map(([label, value]) => (
              <li key={label}>
                {label === "S1" && (
                  <div className="relative my-1 flex flex-col items-center gap-1 border-y border-[#262626] py-2">
                    <span className="rounded-full bg-[#2a2a2a] px-3 py-0.5 text-[11px] font-semibold tracking-wide text-[#e5e5e5]">
                      PRICE {last !== null ? fmt(last) : "—"}
                    </span>
                    <span className="rounded-full bg-[#1a1a1a] px-3 py-0.5 text-[11px] font-semibold tracking-wide text-[#999]">
                      PIVOT {fmt(state.pivots.pivot)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between px-5 py-3 text-sm">
                  <span className={`font-medium ${label.startsWith("R") ? "text-[#ef8a6f]" : "text-[#4fd1a9]"}`}>{label}</span>
                  <span className="font-semibold tabular-nums">{fmt(value)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ constituents */

type ConstituentQuote = { symbol: string; price: number; changePercent: number | null; volume: number | null; currency: string };

const PAGE_SIZE = 10;

export function Nifty50Constituents() {
  const [quotes, setQuotes] = useState<ConstituentQuote[] | null | undefined>(undefined);
  const [page, setPage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/market/nifty50")
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setQuotes(
          data?.success
            ? [...(data.quotes as ConstituentQuote[])].sort((a, b) => a.symbol.localeCompare(b.symbol))
            : null
        );
      })
      .catch(() => {
        if (!cancelled) setQuotes(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (quotes === null) return null;

  const pages = quotes ? Math.ceil(quotes.length / PAGE_SIZE) : 1;
  const visible = quotes ? quotes.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE) : [];

  return (
    <section aria-labelledby="constituents-title">
      <SectionTitle note={quotes ? `${quotes.length} companies` : undefined}>
        <span id="constituents-title">NIFTY 50 companies</span>
      </SectionTitle>
      <div className="overflow-hidden rounded-2xl border border-[#222] bg-[#0d0d0d]">
        <table className="w-full text-sm">
          <thead className="border-b border-[#222] text-xs uppercase tracking-wide text-[#777]">
            <tr>
              <th scope="col" className="px-5 py-3 text-left font-medium">Company</th>
              <th scope="col" className="px-5 py-3 text-right font-medium">Market price</th>
              <th scope="col" className="hidden px-5 py-3 text-right font-medium sm:table-cell">Volume</th>
            </tr>
          </thead>
          <tbody>
            {quotes === undefined
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-[#1b1b1b] last:border-b-0">
                    <td colSpan={3} className="px-5 py-4">
                      <div className="h-6 animate-pulse rounded bg-[#151515]" />
                    </td>
                  </tr>
                ))
              : visible.map((quote) => (
                  <tr key={quote.symbol} className="group border-b border-[#1b1b1b] transition-colors last:border-b-0 hover:bg-[#141414]">
                    <td className="px-5 py-3.5">
                      <Link href={`/stock/${encodeURIComponent(quote.symbol)}`} className="flex items-center gap-3">
                        <StockAvatar symbol={quote.symbol} size={32} market="India" />
                        <span className="font-medium group-hover:text-[#22c55e]">{quote.symbol}</span>
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="block font-medium tabular-nums">{formatValue(quote.price, "currency", quote.currency)}</span>
                      {quote.changePercent !== null && (
                        <span className="block text-xs tabular-nums" style={{ color: quote.changePercent >= 0 ? UP : DOWN }}>
                          ({quote.changePercent >= 0 ? "+" : ""}
                          {quote.changePercent.toFixed(2)}%)
                        </span>
                      )}
                    </td>
                    <td className="hidden px-5 py-3.5 text-right tabular-nums text-[#bbb] sm:table-cell">
                      {formatCompactVolume(quote.volume, true)}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>

        {quotes && pages > 1 && (
          <nav aria-label="Pages" className="flex items-center justify-center gap-1 border-t border-[#1b1b1b] py-3">
            <button
              type="button"
              aria-label="Previous page"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg px-3 py-1 text-[#aaa] hover:bg-[#1a1a1a] disabled:opacity-30"
            >
              ‹
            </button>
            {Array.from({ length: pages }).map((_, i) => (
              <button
                key={i}
                type="button"
                aria-current={page === i ? "page" : undefined}
                onClick={() => setPage(i)}
                className={`h-8 w-8 rounded-full text-sm tabular-nums ${page === i ? "bg-[#00b386]/15 font-semibold text-[#00b386]" : "text-[#999] hover:bg-[#1a1a1a]"}`}
              >
                {i + 1}
              </button>
            ))}
            <button
              type="button"
              aria-label="Next page"
              disabled={page >= pages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg px-3 py-1 text-[#aaa] hover:bg-[#1a1a1a] disabled:opacity-30"
            >
              ›
            </button>
          </nav>
        )}
      </div>
      <p className="mt-2 text-[11px] text-[#666]">Market cap and sector aren&apos;t available from our current data sources.</p>
    </section>
  );
}

/* ------------------------------------------------------------ all indices */

function Sparkline({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return <span className="inline-block h-8 w-28" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * 112).toFixed(1)},${(30 - ((v - min) / span) * 28).toFixed(1)}`)
    .join(" ");
  const baseline = 30 - ((values[0] - min) / span) * 28;

  return (
    <svg width="112" height="32" viewBox="0 0 112 32" aria-hidden="true" className="inline-block">
      <line x1="0" x2="112" y1={baseline} y2={baseline} stroke="#333" strokeDasharray="2 3" />
      <polyline points={points} fill="none" stroke={up ? UP : DOWN} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function AllIndices({ current }: { current: string }) {
  const [rows, setRows] = useState<IndexOverviewRow[] | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/indices/overview")
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setRows(data?.success ? (data.indices as IndexOverviewRow[]) : null);
      })
      .catch(() => {
        if (!cancelled) setRows(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (rows === null) return null;

  const others = (rows ?? []).filter((row) => row.symbol !== current);

  return (
    <section aria-labelledby="all-indices-title">
      <SectionTitle>
        <span id="all-indices-title">All indices</span>
      </SectionTitle>
      <div className="overflow-x-auto rounded-2xl border border-[#222] bg-[#0d0d0d]">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b border-[#222] text-xs uppercase tracking-wide text-[#777]">
            <tr>
              <th scope="col" className="px-5 py-3 text-left font-medium">Index</th>
              <th scope="col" className="px-2 py-3 font-medium"><span className="sr-only">Today</span></th>
              <th scope="col" className="px-5 py-3 text-right font-medium">Value</th>
              <th scope="col" className="px-5 py-3 text-right font-medium">52W high</th>
              <th scope="col" className="px-5 py-3 text-right font-medium">52W low</th>
            </tr>
          </thead>
          <tbody>
            {rows === undefined
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-[#1b1b1b] last:border-b-0">
                    <td colSpan={5} className="px-5 py-4">
                      <div className="h-7 animate-pulse rounded bg-[#151515]" />
                    </td>
                  </tr>
                ))
              : others.map((row) => {
                  const up = (row.change ?? 0) >= 0;
                  const fmt = (v: number | null) => formatValue(v, "points", null);
                  return (
                    <tr key={row.symbol} className="group border-b border-[#1b1b1b] transition-colors last:border-b-0 hover:bg-[#141414]">
                      <td className="px-5 py-3">
                        <Link href={`/asset/index/${row.symbol}`} className="font-medium group-hover:text-[#22c55e]">
                          {row.name}
                        </Link>
                        <span className="block text-[11px] text-[#666]">{row.category === "indian" ? "India" : "Global"}</span>
                      </td>
                      <td className="px-2 py-3 text-center">
                        <Sparkline values={row.spark} up={up} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className="block font-medium tabular-nums">{fmt(row.price)}</span>
                        {row.changePercent !== null && (
                          <span className="block text-xs tabular-nums" style={{ color: up ? UP : DOWN }}>
                            ({up ? "+" : ""}
                            {row.changePercent.toFixed(2)}%)
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-[#bbb]">{fmt(row.fiftyTwoWeekHigh)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-[#bbb]">{fmt(row.fiftyTwoWeekLow)}</td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
