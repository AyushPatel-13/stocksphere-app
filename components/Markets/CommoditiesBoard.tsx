"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { EmptyState, PageHeader, PageShell, secondaryButtonClass } from "@/components/ui/Page";
import { formatValue } from "@/lib/charts/format";
import { COMMODITIES, COMMODITY_CATEGORIES, type CommodityCategory } from "@/lib/data/commodities";
import {
  contractMonth,
  filterByCategory,
  formatExpiry,
  formatLots,
  freshnessLabel,
  quoteUnitLabel,
} from "@/lib/markets/commodities";
import type { CommodityBoard, CommodityQuote, CommodityRow } from "@/lib/services/commodities";

/**
 * The Commodities page: MCX futures by category, one row per product showing
 * its nearest open contract. Every figure is Upstox's; a missing figure is
 * shown as missing, never filled in.
 */

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; board: CommodityBoard };

const REFRESH_MS = 30_000;
const FILTERS = ["All", ...COMMODITY_CATEGORIES] as const;

export function commodityHref(symbol: string, expiry?: string): string {
  return `/commodities/${encodeURIComponent(symbol)}${expiry ? `?expiry=${expiry}` : ""}`;
}

export function FreshnessBadge({ quote }: { quote: CommodityQuote | null }) {
  const { label, tone } = freshnessLabel(quote);
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] ${
        tone === "live" ? "text-[#4ade80]" : tone === "stale" ? "text-[#888]" : "text-[#666]"
      }`}
    >
      {tone === "live" && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />}
      {label}
    </span>
  );
}

export function ChangeText({ quote }: { quote: CommodityQuote | null }) {
  if (!quote || quote.change === null) return <span className="text-[#666]">—</span>;
  const up = quote.change >= 0;
  return (
    <span className={`tabular-nums ${up ? "text-[#4ade80]" : "text-[#f87171]"}`}>
      {up ? "+" : "-"}
      {formatValue(Math.abs(quote.change), "currency", "INR")}
      {quote.changePercent !== null && ` (${Math.abs(quote.changePercent).toFixed(2)}%)`}
    </span>
  );
}

function Row({ row }: { row: CommodityRow }) {
  const { contract, quote } = row;
  return (
    <li className="border-b border-[#1b1b1b] last:border-b-0">
      <Link
        href={commodityHref(row.symbol, contract.expiry)}
        className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-[#151515] sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,0.9fr)] sm:px-5"
      >
        <span className="min-w-0">
          <span className="block truncate font-semibold group-hover:text-[#22c55e]">
            {row.name} <span className="font-normal text-[#888]">{contractMonth(contract.expiry)} FUT</span>
          </span>
          <span className="block truncate text-xs text-[#777]">
            {contract.tradingSymbol} · {row.exchange} · Exp {formatExpiry(contract.expiry)}
          </span>
        </span>

        <span className="text-right sm:text-left">
          <span className="block font-medium tabular-nums">
            {quote?.price != null ? formatValue(quote.price, "currency", "INR") : <span className="text-xs text-[#777]">Unavailable</span>}
            <span className="ml-1 text-[11px] font-normal text-[#777]">{quoteUnitLabel(row.quoteUnit)}</span>
          </span>
          <span className="block">
            <FreshnessBadge quote={quote} />
          </span>
        </span>

        <span className="col-span-2 flex items-center justify-between gap-3 text-xs sm:col-span-1 sm:block sm:text-sm">
          <span className="text-[#777] sm:hidden">1D change</span>
          <ChangeText quote={quote} />
        </span>

        <span className="col-span-2 flex items-center justify-between gap-3 text-xs text-[#ccc] sm:col-span-1 sm:block sm:text-right sm:text-sm">
          <span className="text-[#777] sm:hidden">Volume</span>
          <span className="tabular-nums">{quote?.volume != null ? formatLots(quote.volume) : "—"}</span>
        </span>
      </Link>
    </li>
  );
}

export default function CommoditiesBoard() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<CommodityCategory | "All">("All");

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const load = () => {
      fetch("/api/commodities")
        .then((response) => response.json())
        .then((data) => {
          if (cancelled) return;
          if (data?.success) setState({ status: "ready", board: data as CommodityBoard });
          // A failed refresh keeps the board already on screen.
          else setState((current) => (current.status === "ready" ? current : { status: "error", message: data?.error ?? "Commodity prices couldn't be loaded." }));
        })
        .catch(() => {
          if (!cancelled) setState((current) => (current.status === "ready" ? current : { status: "error", message: "Commodity prices couldn't be loaded." }));
        })
        .finally(schedule);
    };
    // Refresh while the tab is visible; a hidden tab just waits for the next tick.
    const tick = () => (document.hidden ? schedule() : load());
    function schedule() {
      if (!cancelled) timer = window.setTimeout(tick, REFRESH_MS);
    }
    load();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [attempt]);

  const board = state.status === "ready" ? state.board : null;
  const rows = board ? filterByCategory(board.rows, filter) : [];
  const missing = board ? board.unavailable.filter((entry) => filter === "All" || COMMODITIES.find((c) => c.symbol === entry.symbol)?.category === filter) : [];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Commodities"
        title="Commodity futures"
        description="MCX futures for energy, bullion and base metals, priced in rupees. Each row is the nearest open contract; open one for every expiry and its chart."
      />

      <div role="group" aria-label="Category" className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
              filter === option
                ? "border-[#22c55e] bg-[#22c55e] text-black"
                : "border-[#2a2a2a] bg-[#111] text-[#bbb] hover:border-[#3a3a3a] hover:text-white"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {state.status === "loading" && (
        <div className="space-y-2" aria-busy="true" aria-label="Loading commodity prices">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-[#111]" />
          ))}
        </div>
      )}

      {state.status === "error" && (
        <div role="alert" className="rounded-2xl border border-[#222] bg-[#111] px-6 py-12 text-center">
          <p className="font-semibold">Commodity prices are unavailable</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-[#888]">{state.message}</p>
          <button
            type="button"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
            className={`${secondaryButtonClass} mt-4`}
          >
            Try again
          </button>
        </div>
      )}

      {board && rows.length === 0 && (
        <EmptyState
          icon="🛢️"
          title={`No ${filter === "All" ? "" : `${filter} `}contracts to show`}
          description="Upstox didn't return an open MCX contract for this category right now."
        />
      )}

      {board && rows.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,0.9fr)] gap-x-4 border-b border-[#1f1f1f] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#777] sm:grid">
            <span>Commodity</span>
            <span>Price</span>
            <span>1D change</span>
            <span className="text-right">Volume</span>
          </div>
          <ul>
            {rows.map((row) => (
              <Row key={row.symbol} row={row} />
            ))}
          </ul>
        </div>
      )}

      {missing.length > 0 && (
        <p className="mt-4 text-xs leading-relaxed text-[#777]">
          Not available right now: {missing.map((entry) => entry.name).join(", ")}.
        </p>
      )}

      <p className="mt-6 text-[11px] leading-relaxed text-[#666]">
        Source: Upstox, MCX futures. &ldquo;Live&rdquo; means the contract traded in the last 10 minutes; otherwise the
        price is the last trade, with its time. 1D change is against the previous session&apos;s close. Volume is in lots.
        {board && ` Updated ${new Date(board.fetchedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.`}{" "}
        For information only — not investment advice.
      </p>
    </PageShell>
  );
}
