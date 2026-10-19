"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import AuthGuard from "@/components/AuthGuard";
import MarketsNav from "@/components/Markets/MarketsNav";
import { StockAvatar, absPercent, toneClass } from "@/components/Markets/StockBits";
import {
  EmptyState,
  PageShell,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/Page";
import { formatMoney, formatVolume, useQuotes, type LiveQuote } from "@/lib/client/useQuotes";
import { isValidSymbol } from "@/lib/validation/symbol";
import { addToWatchlist, getWatchlist, removeFromWatchlist } from "@/lib/watchlist";

/**
 * Watchlist.
 *
 * One list per user — that is what the `watchlist` table holds today (user_id,
 * symbol). Several named lists need a schema change, which waits on the
 * Supabase RLS review.
 */

type SortKey = "company" | "price" | "change" | "volume";

function sortValue(symbol: string, quote: LiveQuote | null, key: SortKey): number | string {
  if (key === "company") return symbol;
  if (!quote) return -Infinity;
  if (key === "price") return quote.price;
  if (key === "change") return quote.changePercent ?? -Infinity;
  return quote.volume ?? -Infinity;
}

function SortHeader({
  label,
  k,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === k;

  return (
    <th
      scope="col"
      aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
      className={`px-4 py-3 font-medium ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 hover:text-white ${active ? "text-white" : ""}`}
      >
        {label}
        <span aria-hidden="true" className="text-[9px]">
          {active ? (sort.desc ? "▼" : "▲") : "⇅"}
        </span>
      </button>
    </th>
  );
}

export default function WatchlistPage() {
  const [symbols, setSymbols] = useState<string[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "company", desc: false });

  useEffect(() => {
    let cancelled = false;

    getWatchlist()
      .then((saved) => {
        if (!cancelled) {
          setSymbols(saved.map((item: { symbol: string }) => String(item.symbol).toUpperCase()));
        }
      })
      .catch((error) => {
        console.error("Watchlist load error:", error);
        if (!cancelled) {
          setLoadFailed(true);
          setSymbols([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const list = useMemo(() => symbols ?? [], [symbols]);
  const { loading: quotesLoading, quotes } = useQuotes(list);

  const rows = list
    .filter((symbol) => symbol.includes(search.trim().toUpperCase()))
    .sort((a, b) => {
      const x = sortValue(a, quotes[a] ?? null, sort.key);
      const y = sortValue(b, quotes[b] ?? null, sort.key);
      const order =
        typeof x === "string" && typeof y === "string"
          ? x.localeCompare(y)
          : (x as number) - (y as number);
      return sort.desc ? -order : order;
    });

  function sortBy(key: SortKey) {
    setSort((current) =>
      current.key === key ? { key, desc: !current.desc } : { key, desc: key !== "company" }
    );
  }

  async function add() {
    const symbol = newSymbol.trim().toUpperCase();

    if (!isValidSymbol(symbol)) {
      setAddError("Enter a valid stock symbol, e.g. TCS or AAPL.");
      return;
    }
    if (list.includes(symbol)) {
      setAddError(`${symbol} is already in your watchlist.`);
      return;
    }

    setAddError(null);

    const result = await addToWatchlist(symbol);
    if (!result || result.error) {
      setAddError("Couldn't add it right now. Please try again.");
      return;
    }

    setSymbols([...list, symbol]);
    setNewSymbol("");
  }

  async function remove(symbol: string) {
    await removeFromWatchlist(symbol);
    setSymbols(list.filter((item) => item !== symbol));
  }

  return (
    <AuthGuard>
      <PageShell>
        <MarketsNav />

        <div className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
          {/* List header */}
          <div className="flex items-center gap-6 border-b border-[#222] px-5">
            <span className="relative py-4 font-semibold">
              My Watchlist
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#22c55e]" />
            </span>
            <span className="text-sm text-[#777]">{list.length} stocks</span>
          </div>

          {/* Toolbar */}
          <div className="flex flex-col gap-3 border-b border-[#1d1d1d] p-4 sm:flex-row sm:items-center">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your watchlist"
              aria-label="Search your watchlist"
              className={`${inputClass} sm:max-w-xs`}
            />
            <button
              type="button"
              onClick={() => {
                setAdding((open) => !open);
                setAddError(null);
              }}
              className={`${secondaryButtonClass} sm:ml-auto`}
            >
              {adding ? "Close" : "+ Add stocks"}
            </button>
          </div>

          {adding && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                add();
              }}
              className="border-b border-[#1d1d1d] bg-[#0e0e0e] p-4"
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value)}
                  placeholder="Symbol, e.g. RELIANCE or NVDA"
                  aria-label="Stock symbol to add"
                  autoFocus
                  className={`${inputClass} sm:max-w-xs`}
                />
                <button type="submit" className={primaryButtonClass}>
                  Add
                </button>
              </div>
              {addError && (
                <p role="alert" className="mt-2 text-sm text-[#f87171]">
                  {addError}
                </p>
              )}
            </form>
          )}

          {/* Body */}
          {symbols === null ? (
            <div className="space-y-px p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-[#151515]" />
              ))}
            </div>
          ) : loadFailed ? (
            <p role="status" className="p-8 text-center text-sm text-[#888]">
              Your watchlist couldn&apos;t be loaded right now.
            </p>
          ) : list.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon="⭐"
                title="Your watchlist is empty"
                description="Add stocks to follow their price and daily move in one place."
                action={
                  <button type="button" onClick={() => setAdding(true)} className={primaryButtonClass}>
                    + Add stocks
                  </button>
                }
              />
            </div>
          ) : rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-[#888]">No stocks match “{search}”.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-[#1d1d1d] bg-[#0f0f0f] text-xs text-[#888]">
                <tr>
                  <SortHeader label={`Company (${rows.length})`} k="company" sort={sort} onSort={sortBy} className="text-left" />
                  <SortHeader label="Mkt price" k="price" sort={sort} onSort={sortBy} className="text-right" />
                  <SortHeader label="1D change" k="change" sort={sort} onSort={sortBy} className="hidden text-right sm:table-cell" />
                  <SortHeader label="1D vol" k="volume" sort={sort} onSort={sortBy} className="hidden text-right md:table-cell" />
                  <th scope="col" className="w-10 px-2 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((symbol) => {
                  const quote = quotes[symbol] ?? null;
                  const pending = quotesLoading && !quote;

                  return (
                    <tr
                      key={symbol}
                      className="group border-b border-[#1b1b1b] transition-colors last:border-b-0 hover:bg-[#151515]"
                    >
                      <td className="px-4 py-3.5">
                        <Link href={`/stock/${encodeURIComponent(symbol)}`} className="flex items-center gap-3">
                          <StockAvatar symbol={symbol} size={36} />
                          <span className="font-semibold group-hover:text-[#22c55e]">{symbol}</span>
                        </Link>
                      </td>

                      <td className="px-4 py-3.5 text-right">
                        {pending ? (
                          <span className="ml-auto block h-4 w-20 animate-pulse rounded bg-[#1c1c1c]" />
                        ) : quote ? (
                          <>
                            <span className="block font-medium tabular-nums">
                              {formatMoney(quote.price, quote.currency)}
                            </span>
                            {/* The 1D change sits under the price on phones. */}
                            <span className={`block text-xs tabular-nums sm:hidden ${toneClass(quote.change)}`}>
                              {absPercent(quote.changePercent)}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-[#777]">Unavailable</span>
                        )}
                      </td>

                      <td className={`hidden px-4 py-3.5 text-right font-medium tabular-nums sm:table-cell ${toneClass(quote?.change ?? null)}`}>
                        {pending ? (
                          <span className="ml-auto block h-4 w-24 animate-pulse rounded bg-[#1c1c1c]" />
                        ) : quote && quote.change !== null ? (
                          `${formatMoney(quote.change, quote.currency, true)} (${absPercent(quote.changePercent)})`
                        ) : (
                          "—"
                        )}
                      </td>

                      <td className="hidden px-4 py-3.5 text-right tabular-nums text-[#ccc] md:table-cell">
                        {pending ? (
                          <span className="ml-auto block h-4 w-16 animate-pulse rounded bg-[#1c1c1c]" />
                        ) : (
                          formatVolume(quote?.volume ?? null, quote?.currency)
                        )}
                      </td>

                      <td className="px-2 py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => remove(symbol)}
                          aria-label={`Remove ${symbol} from watchlist`}
                          className="rounded-lg p-2 text-[#666] transition-colors hover:bg-[#2a1414] hover:text-[#f87171] sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </PageShell>
    </AuthGuard>
  );
}
