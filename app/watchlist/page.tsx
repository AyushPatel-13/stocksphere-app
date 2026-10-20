"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import AuthGuard from "@/components/AuthGuard";
import MarketsNav from "@/components/Markets/MarketsNav";
import { MiniRange, Sparkline, rangePosition } from "@/components/Markets/Sparkline";
import { StockAvatar, absPercent, toneClass } from "@/components/Markets/StockBits";
import SearchBox from "@/components/Search/SearchBox";
import { EmptyState, PageShell, primaryButtonClass, secondaryButtonClass } from "@/components/ui/Page";
import { formatMoney, formatVolume } from "@/lib/client/useQuotes";
import { canonicalStockSymbol } from "@/lib/search/canonical";
import type { SearchResult } from "@/lib/search/instruments";
import type { WatchlistRow } from "@/lib/services/watchlistRows";
import { addToWatchlist, getWatchlist, removeFromWatchlist } from "@/lib/watchlist";
import {
  MAX_LISTS,
  MAX_NAME_LENGTH,
  addToList,
  createList,
  deleteList,
  getListSymbols,
  loadWatchlistMode,
  removeFromList,
  renameList,
  type NamedWatchlist,
  type WatchlistMode,
} from "@/lib/watchlists";

/**
 * Watchlist: named lists (once the watchlists migration is applied; one list
 * before that), each a sortable table with a day sparkline, price, day change,
 * volume and 52-week range. All market data comes from one batched request to
 * /api/watchlist/rows; a missing value shows "—", never a guess.
 */

/* ------------------------------------------------------------ data */

type RowsState = { loading: boolean; failed: boolean; rows: Record<string, WatchlistRow> };

const REFRESH_MS = 60_000;

function useWatchlistRows(symbols: string[]): RowsState {
  const key = useMemo(() => [...symbols].sort().join(","), [symbols]);
  const [state, setState] = useState<RowsState & { key: string }>({ key: "", loading: false, failed: false, rows: {} });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;

    async function load() {
      const all = key.split(",");
      const chunks: string[][] = [];
      for (let i = 0; i < all.length; i += 50) chunks.push(all.slice(i, i + 50));

      try {
        const results = await Promise.all(
          chunks.map(async (chunk) => {
            const response = await fetch(`/api/watchlist/rows?symbols=${encodeURIComponent(chunk.join(","))}`);
            const data = await response.json();
            if (!data?.success) throw new Error(data?.error ?? "failed");
            return data.rows as WatchlistRow[];
          })
        );
        if (!cancelled) {
          setState({ key, loading: false, failed: false, rows: Object.fromEntries(results.flat().map((row) => [row.symbol, row])) });
        }
      } catch {
        if (!cancelled) setState((current) => ({ ...current, key, loading: false, failed: true }));
      }
    }

    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [key]);

  if (!key) return { loading: false, failed: false, rows: {} };
  return { loading: state.key !== key, failed: state.key === key && state.failed, rows: state.rows };
}

/* ------------------------------------------------------------ sorting */

type SortKey = "company" | "price" | "change" | "volume" | "range";
type Sort = { key: SortKey; desc: boolean };

function sortValue(symbol: string, row: WatchlistRow | undefined, key: SortKey): number | string {
  if (key === "company") return symbol;
  if (!row) return -Infinity;
  if (key === "price") return row.price ?? -Infinity;
  if (key === "change") return row.changePercent ?? -Infinity;
  if (key === "volume") return row.volume ?? -Infinity;
  return rangePosition(row.fiftyTwoWeekLow, row.fiftyTwoWeekHigh, row.price) ?? -Infinity;
}

function SortHeader({ label, k, sort, onSort, className = "" }: { label: string; k: SortKey; sort: Sort; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort.key === k;
  return (
    <th scope="col" aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"} className={`px-3 py-3 font-medium ${className}`}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 rounded hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/40 ${active ? "text-white" : ""}`}
      >
        {label}
        <span aria-hidden="true" className="text-[9px]">
          {active ? (sort.desc ? "▼" : "▲") : "⇅"}
        </span>
      </button>
    </th>
  );
}

/* ------------------------------------------------------------ empty state */

type Suggestion = { symbol: string; price: number; changePercent: number | null };

function TrendingSuggestions({ onAdd, isAdded }: { onAdd: (symbol: string) => void; isAdded: (symbol: string) => boolean }) {
  const [items, setItems] = useState<Suggestion[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/market/movers")
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        const list = data?.success ? [...(data.gainers ?? []), ...(data.losers ?? [])] : [];
        setItems(list.slice(0, 6));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (items === null) return <div className="mt-6 h-24 animate-pulse rounded-xl bg-[#151515]" />;
  if (items.length === 0) return null;

  return (
    <div className="mt-6 text-left">
      <p className="mb-2 text-sm font-medium text-[#aaa]">Moving today on the NIFTY 50</p>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const added = isAdded(item.symbol);
          return (
            <li key={item.symbol} className="flex items-center gap-3 rounded-xl border border-[#222] bg-[#0f0f0f] px-3 py-2.5">
              <StockAvatar symbol={item.symbol} size={30} />
              <Link href={`/stock/${encodeURIComponent(item.symbol)}`} className="min-w-0 flex-1 hover:text-[#22c55e]">
                <span className="block truncate text-sm font-semibold">{item.symbol}</span>
                <span className={`text-xs tabular-nums ${toneClass(item.changePercent)}`}>{absPercent(item.changePercent)}</span>
              </Link>
              <button
                type="button"
                disabled={added}
                onClick={() => onAdd(item.symbol)}
                aria-label={added ? `${item.symbol} is in this list` : `Add ${item.symbol}`}
                className="rounded-lg border border-[#2a2a2a] px-2.5 py-1 text-xs font-semibold text-[#4ade80] hover:bg-[#22c55e]/10 disabled:text-[#666]"
              >
                {added ? "Added" : "+ Add"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------ page */

type Notice = { tone: "ok" | "error"; text: string } | null;

export default function WatchlistPage() {
  const [mode, setMode] = useState<WatchlistMode | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<string[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [sort, setSort] = useState<Sort>({ key: "company", desc: false });
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const lists = mode?.mode === "multi" ? mode.lists : [];
  const activeList = lists.find((list) => list.id === activeId) ?? lists[0] ?? null;
  const isFirst = activeList !== null && activeList.id === lists[0]?.id;

  // Lists (or single mode).
  useEffect(() => {
    let cancelled = false;
    loadWatchlistMode()
      .then((result) => {
        if (!cancelled) setMode(result);
      })
      .catch((error) => {
        console.error("Watchlists load error:", error);
        if (!cancelled) setMode({ mode: "single" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Symbols of the active list.
  useEffect(() => {
    if (!mode) return;
    let cancelled = false;

    const load =
      mode.mode === "single"
        ? getWatchlist().then((rows) => rows.map((row) => String(row.symbol).toUpperCase()))
        : activeList
          ? getListSymbols(activeList, isFirst)
          : Promise.resolve([]);

    load
      .then((loaded) => {
        if (cancelled) return;
        setSymbols(loaded);
        setLoadFailed(false);
      })
      .catch((error) => {
        console.error("Watchlist load error:", error);
        if (cancelled) return;
        setLoadFailed(true);
        setSymbols([]);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, activeList, isFirst, reload]);

  const list = useMemo(() => symbols ?? [], [symbols]);
  const data = useWatchlistRows(list);

  const query = search.trim().toUpperCase().replace(/\s+/g, "");
  const rows = list
    .filter((symbol) => !query || symbol.includes(query) || (data.rows[symbol]?.name ?? "").toUpperCase().replace(/\s+/g, "").includes(query))
    .sort((a, b) => {
      const x = sortValue(a, data.rows[a], sort.key);
      const y = sortValue(b, data.rows[b], sort.key);
      const order = typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : (x as number) - (y as number);
      return sort.desc ? -order : order;
    });

  const asOf = Object.values(data.rows)
    .map((row) => (row.asOf ? Date.parse(row.asOf) : NaN))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];

  function sortBy(key: SortKey) {
    setSort((current) => (current.key === key ? { key, desc: !current.desc } : { key, desc: key !== "company" }));
  }

  const isAddedSymbol = useCallback((symbol: string) => list.includes(symbol.toUpperCase()), [list]);

  async function addSymbol(symbol: string, label = symbol) {
    if (isAddedSymbol(symbol)) {
      setNotice({ tone: "ok", text: `${label} is already in this list.` });
      return;
    }
    const response = mode?.mode === "multi" && activeList ? await addToList(activeList.id, symbol) : await addToWatchlist(symbol);
    if (!response || response.error) {
      setNotice({ tone: "error", text: `Couldn't add ${label} right now. Please try again.` });
      return;
    }
    setSymbols((current) => [...(current ?? []), symbol]);
    setNotice({ tone: "ok", text: `Added ${label}.` });
  }

  function addResult(result: SearchResult) {
    return addSymbol(canonicalStockSymbol(result.symbol, result.market), result.name);
  }

  async function remove(targets: string[]) {
    if (targets.length === 0) return;
    let failed = false;

    if (mode?.mode === "multi" && activeList) {
      const response = await removeFromList(activeList, isFirst, targets);
      failed = Boolean(response.error);
    } else {
      for (const symbol of targets) {
        const response = await removeFromWatchlist(symbol);
        if (!response || response.error) failed = true;
      }
    }

    if (failed) {
      setNotice({ tone: "error", text: "Some stocks couldn't be removed. Please try again." });
      setReload((n) => n + 1);
      return;
    }
    setSymbols((current) => (current ?? []).filter((symbol) => !targets.includes(symbol)));
    setSelected(new Set());
    setNotice({ tone: "ok", text: targets.length === 1 ? `Removed ${targets[0]}.` : `Removed ${targets.length} stocks.` });
  }

  async function submitNewList() {
    if (newName === null || mode?.mode !== "multi") return;
    try {
      const created = await createList(newName, lists.length);
      setMode({ mode: "multi", lists: [...lists, created] });
      setActiveId(created.id);
      setSymbols(null);
      setNewName(null);
      setNotice(null);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Couldn't create the list." });
    }
  }

  async function submitRename() {
    if (renaming === null || !activeList || mode?.mode !== "multi") return;
    try {
      await renameList(activeList.id, renaming);
      setMode({ mode: "multi", lists: lists.map((l) => (l.id === activeList.id ? { ...l, name: renaming.trim() } : l)) });
      setRenaming(null);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Couldn't rename the list." });
    }
  }

  async function removeList() {
    if (!activeList || isFirst || mode?.mode !== "multi") return;
    if (!window.confirm(`Delete “${activeList.name}” and the ${list.length} stocks in it?`)) return;
    try {
      await deleteList(activeList.id);
      const rest = lists.filter((l) => l.id !== activeList.id);
      setMode({ mode: "multi", lists: rest });
      setActiveId(rest[0]?.id ?? null);
      setSymbols(null);
      setEditing(false);
    } catch {
      setNotice({ tone: "error", text: "Couldn't delete the list." });
    }
  }

  function selectList(list: NamedWatchlist) {
    if (list.id === activeList?.id) return;
    setActiveId(list.id);
    setSymbols(null);
    setSelected(new Set());
    setEditing(false);
    setRenaming(null);
    setNotice(null);
  }

  const allVisibleSelected = rows.length > 0 && rows.every((symbol) => selected.has(symbol));

  return (
    <AuthGuard>
      <PageShell>
        <MarketsNav />

        <div className="rounded-2xl border border-[#222] bg-[#111]">
          {/* Lists */}
          <div className="flex items-center gap-1 overflow-x-auto border-b border-[#222] px-3" role="tablist" aria-label="Watchlists">
            {mode?.mode === "multi" ? (
              <>
                {lists.map((l) => {
                  const active = l.id === activeList?.id;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => selectList(l)}
                      className={`relative shrink-0 px-3 py-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/40 ${active ? "text-white" : "text-[#888] hover:text-white"}`}
                    >
                      {l.name}
                      {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[#22c55e]" />}
                    </button>
                  );
                })}
                {newName === null ? (
                  lists.length < MAX_LISTS && (
                    <button
                      type="button"
                      onClick={() => setNewName("")}
                      className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-[#4ade80] hover:bg-[#22c55e]/10"
                    >
                      + New list
                    </button>
                  )
                ) : (
                  <form
                    className="flex shrink-0 items-center gap-1.5 py-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitNewList();
                    }}
                  >
                    <input
                      autoFocus
                      value={newName}
                      maxLength={MAX_NAME_LENGTH}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setNewName(null)}
                      placeholder="List name"
                      aria-label="New list name"
                      className="w-36 rounded-lg border border-[#2a2a2a] bg-black px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#22c55e]/60"
                    />
                    <button type="submit" className="rounded-lg bg-[#22c55e] px-2.5 py-1.5 text-xs font-semibold text-black">
                      Create
                    </button>
                    <button type="button" onClick={() => setNewName(null)} className="px-1.5 text-xs text-[#888] hover:text-white">
                      Cancel
                    </button>
                  </form>
                )}
              </>
            ) : (
              <span className="relative px-3 py-4 text-sm font-semibold">
                My Watchlist
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[#22c55e]" />
              </span>
            )}
            <span className="ml-auto shrink-0 pl-3 text-sm text-[#777]">{list.length} stocks</span>
          </div>

          {/* Toolbar: search on the left, actions on the right. */}
          <div className="flex flex-col gap-3 border-b border-[#1d1d1d] p-4 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1 sm:max-w-md">
              <SearchBox
                variant="compact"
                inputId="watchlist-search"
                placeholder="Search this list or add a stock…"
                filterTypes={["stock", "etf"]}
                onQueryChange={(value) => {
                  setSearch(value);
                  setNotice(null);
                }}
                onSelect={addResult}
                isAdded={(result) => isAddedSymbol(canonicalStockSymbol(result.symbol, result.market)) || isAddedSymbol(result.symbol)}
              />
            </div>
            <div className="flex shrink-0 gap-2 sm:ml-auto">
              <button
                type="button"
                onClick={() => document.getElementById("watchlist-search")?.focus()}
                className={primaryButtonClass}
              >
                + Add stocks
              </button>
              <button
                type="button"
                aria-pressed={editing}
                onClick={() => {
                  setEditing((value) => !value);
                  setSelected(new Set());
                  setRenaming(null);
                }}
                disabled={list.length === 0 && mode?.mode !== "multi"}
                className={secondaryButtonClass}
              >
                {editing ? "Done" : "Edit"}
              </button>
            </div>
          </div>

          {editing && (
            <div className="flex flex-wrap items-center gap-2 border-b border-[#1d1d1d] bg-[#0d0d0d] px-4 py-3 text-sm">
              <button
                type="button"
                disabled={selected.size === 0}
                onClick={() => remove([...selected])}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 font-semibold text-red-400 hover:bg-red-500 hover:text-white disabled:opacity-40"
              >
                Remove selected{selected.size > 0 ? ` (${selected.size})` : ""}
              </button>
              {mode?.mode === "multi" && activeList && (
                <>
                  {renaming === null ? (
                    <button type="button" onClick={() => setRenaming(activeList.name)} className="rounded-lg px-3 py-1.5 text-[#ccc] hover:bg-[#1a1a1a]">
                      Rename list
                    </button>
                  ) : (
                    <form
                      className="flex items-center gap-1.5"
                      onSubmit={(event) => {
                        event.preventDefault();
                        submitRename();
                      }}
                    >
                      <input
                        autoFocus
                        value={renaming}
                        maxLength={MAX_NAME_LENGTH}
                        onChange={(e) => setRenaming(e.target.value)}
                        aria-label="List name"
                        className="w-40 rounded-lg border border-[#2a2a2a] bg-black px-2.5 py-1.5 text-white outline-none focus:border-[#22c55e]/60"
                      />
                      <button type="submit" className="rounded-lg bg-[#22c55e] px-2.5 py-1.5 text-xs font-semibold text-black">
                        Save
                      </button>
                    </form>
                  )}
                  {!isFirst && (
                    <button type="button" onClick={removeList} className="rounded-lg px-3 py-1.5 text-red-400 hover:bg-[#2a1414]">
                      Delete list
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {notice && (
            <p role="status" className={`border-b border-[#1d1d1d] px-4 py-2 text-sm ${notice.tone === "error" ? "text-[#f87171]" : "text-[#4ade80]"}`}>
              {notice.text}
            </p>
          )}

          {/* Body */}
          {symbols === null || mode === null ? (
            <div className="space-y-px p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-[#151515]" />
              ))}
            </div>
          ) : loadFailed ? (
            <div className="p-8 text-center">
              <p role="status" className="text-sm text-[#888]">This watchlist couldn&apos;t be loaded right now.</p>
              <button type="button" onClick={() => setReload((n) => n + 1)} className={`${secondaryButtonClass} mt-3`}>
                Try again
              </button>
            </div>
          ) : list.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon="⭐"
                title="This list is empty"
                description="Add stocks to follow their price, daily move and 52-week range in one place."
                action={
                  <button type="button" onClick={() => document.getElementById("watchlist-search")?.focus()} className={primaryButtonClass}>
                    + Add stocks
                  </button>
                }
              />
              <TrendingSuggestions onAdd={(symbol) => addSymbol(symbol)} isAdded={isAddedSymbol} />
            </div>
          ) : rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-[#888]">
              Nothing in this list matches “{search}” — pick a suggestion above to add it.
            </p>
          ) : (
            <div className="overflow-hidden rounded-b-2xl">
              {data.failed && (
                <p className="border-b border-[#1d1d1d] px-4 py-2 text-xs text-[#f87171]">Prices couldn&apos;t be refreshed. Showing the last ones loaded.</p>
              )}
              <table className="w-full text-sm">
                <thead className="border-b border-[#1d1d1d] bg-[#0f0f0f] text-xs text-[#888]">
                  <tr>
                    {editing && (
                      <th scope="col" className="w-10 pl-4">
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          checked={allVisibleSelected}
                          onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(rows))}
                          className="h-4 w-4 accent-[#22c55e]"
                        />
                      </th>
                    )}
                    <SortHeader label={`Company (${rows.length})`} k="company" sort={sort} onSort={sortBy} className="pl-4 text-left" />
                    <th scope="col" className="hidden px-3 py-3 text-left font-medium md:table-cell">
                      1D chart
                    </th>
                    <SortHeader label="Mkt price" k="price" sort={sort} onSort={sortBy} className="text-right" />
                    <SortHeader label="1D change" k="change" sort={sort} onSort={sortBy} className="hidden text-right sm:table-cell" />
                    <SortHeader label="1D vol" k="volume" sort={sort} onSort={sortBy} className="hidden text-right lg:table-cell" />
                    <SortHeader label="52W range" k="range" sort={sort} onSort={sortBy} className="hidden text-left xl:table-cell" />
                    {!editing && (
                      <th scope="col" className="w-10 px-2 py-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((symbol) => {
                    const row = data.rows[symbol];
                    const pending = data.loading && !row;
                    const priced = row && row.price !== null;
                    const up = (row?.change ?? 0) >= 0;

                    return (
                      <tr key={symbol} className="group border-b border-[#1b1b1b] transition-colors last:border-b-0 hover:bg-[#151515]">
                        {editing && (
                          <td className="pl-4">
                            <input
                              type="checkbox"
                              aria-label={`Select ${symbol}`}
                              checked={selected.has(symbol)}
                              onChange={() =>
                                setSelected((current) => {
                                  const next = new Set(current);
                                  if (next.has(symbol)) next.delete(symbol);
                                  else next.add(symbol);
                                  return next;
                                })
                              }
                              className="h-4 w-4 accent-[#22c55e]"
                            />
                          </td>
                        )}

                        <td className="py-3 pl-4 pr-3">
                          <Link
                            href={`/stock/${encodeURIComponent(symbol)}`}
                            className="flex items-center gap-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/40"
                          >
                            <StockAvatar symbol={symbol} size={36} />
                            <span className="min-w-0">
                              <span className="block truncate font-semibold group-hover:text-[#22c55e]">{row?.name ?? symbol}</span>
                              <span className="block text-xs text-[#777]">{symbol}</span>
                            </span>
                          </Link>
                        </td>

                        <td className="hidden px-3 py-3 md:table-cell">
                          {pending ? (
                            <span className="block h-8 w-28 animate-pulse rounded bg-[#1c1c1c]" />
                          ) : (
                            <Sparkline values={row?.spark ?? []} up={up} />
                          )}
                        </td>

                        <td className="px-3 py-3 text-right">
                          {pending ? (
                            <span className="ml-auto block h-4 w-20 animate-pulse rounded bg-[#1c1c1c]" />
                          ) : priced ? (
                            <>
                              <span className="block font-medium tabular-nums">{formatMoney(row.price!, row.currency ?? "INR")}</span>
                              <span className={`block text-xs tabular-nums sm:hidden ${toneClass(row.change)}`}>{absPercent(row.changePercent)}</span>
                            </>
                          ) : (
                            <span className="text-xs text-[#777]">Unavailable</span>
                          )}
                        </td>

                        <td className={`hidden px-3 py-3 text-right font-medium tabular-nums sm:table-cell ${toneClass(row?.change ?? null)}`}>
                          {pending ? (
                            <span className="ml-auto block h-4 w-24 animate-pulse rounded bg-[#1c1c1c]" />
                          ) : row && row.change !== null ? (
                            `${formatMoney(row.change, row.currency ?? "INR", true)} (${absPercent(row.changePercent)})`
                          ) : (
                            "—"
                          )}
                        </td>

                        <td className="hidden px-3 py-3 text-right tabular-nums text-[#ccc] lg:table-cell">
                          {pending ? <span className="ml-auto block h-4 w-16 animate-pulse rounded bg-[#1c1c1c]" /> : formatVolume(row?.volume ?? null, row?.currency ?? undefined)}
                        </td>

                        <td className="hidden px-3 py-3 xl:table-cell">
                          {row && row.fiftyTwoWeekLow !== null && row.fiftyTwoWeekHigh !== null ? (
                            <span className="flex items-center gap-2 text-[11px] tabular-nums text-[#888]">
                              <span>{row.fiftyTwoWeekLow.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
                              <span className="w-24">
                                <MiniRange low={row.fiftyTwoWeekLow} high={row.fiftyTwoWeekHigh} value={row.price} />
                              </span>
                              <span>{row.fiftyTwoWeekHigh.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-[#666]">—</span>
                          )}
                        </td>

                        {!editing && (
                          <td className="px-2 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => remove([symbol])}
                              aria-label={`Remove ${symbol} from this list`}
                              className="rounded-lg p-2 text-[#666] transition-colors hover:bg-[#2a1414] hover:text-[#f87171] focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                            >
                              ✕
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="mt-3 text-[11px] text-[#666]">
          Prices and 52-week ranges from Yahoo Finance; may be delayed.
          {asOf ? ` Last price ${new Date(asOf).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.` : ""}
          {mode?.mode === "single" && " Named lists switch on once the watchlists database update is applied."}
        </p>
      </PageShell>
    </AuthGuard>
  );
}
