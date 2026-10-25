"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { StockAvatar } from "@/components/Markets/StockBits";
import {
  assetLabel,
  filterKeyOf,
  filtersFromKey,
  nextActiveIndex,
  searchUrl,
  type InstrumentType,
  type Market,
  type SearchResult,
} from "@/lib/search/types";
import { getRecentlyViewed, type RecentlyViewedAsset } from "@/lib/utils/recentlyViewed";

/**
 * The instrument search box every instrument field in StockSphere uses: the
 * header and homepage search, and every "pick a stock" field in a form (see
 * InstrumentField). Suggestions come from /api/search — Indian and US stocks,
 * ETFs, indices, crypto, bonds and MCX commodities (lib/search/instruments.ts).
 *
 * - Debounced; one character searches StockSphere's own lists, two or more
 *   also ask the providers (the server decides).
 * - A newer query always wins: older requests are aborted and their answers
 *   ignored.
 * - Answers are cached per query for the session.
 * - Filters (asset class, market, exchange) are applied by the server, so
 *   the result limit is spent on instruments the field accepts.
 * - ↑/↓ (and Home/End while open) move, Enter opens (the first result if none
 *   is highlighted), Esc closes, clicking outside closes.
 */

const DEBOUNCE_MS = 200;
const CACHE_MAX = 100;
const cache = new Map<string, SearchResult[]>();

const TYPE_STYLE: Record<InstrumentType, string> = {
  stock: "text-[#999]",
  etf: "text-[#c4b5fd]",
  index: "text-[#93c5fd]",
  crypto: "text-[#fcd34d]",
  bond: "text-[#5eead4]",
  commodity: "text-[#fdba74]",
};

type Status = "idle" | "loading" | "ready" | "error" | "invalid";

/** Bold the first place the query appears, without building any HTML. */
function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const index = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-transparent font-semibold text-white">{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

function recentAsResults(assets: RecentlyViewedAsset[]): SearchResult[] {
  return assets.slice(0, 6).map((asset) => {
    const symbol = asset.symbol.toUpperCase();
    const indian = asset.market === "INDIA";
    return {
      id: `recent:${symbol}`,
      symbol,
      name: asset.name || symbol,
      type: "stock",
      exchange: indian ? "NSE" : "US",
      market: indian ? "India" : "US",
      currency: indian ? "INR" : "USD",
      href: `/stock/${encodeURIComponent(symbol)}`,
    };
  });
}

export default function SearchBox({
  variant = "hero",
  autoFocus = false,
  onNavigate,
  onSelect,
  isAdded,
  onQueryChange,
  filterTypes,
  market,
  exchange,
  placeholder = "Search stocks, ETFs, indices, crypto…",
  inputId,
  ariaLabel = "Search stocks, ETFs, indices, crypto and bonds",
  invalid = false,
  describedBy,
}: {
  variant?: "hero" | "compact";
  autoFocus?: boolean;
  /** Called after a result is opened (e.g. to close a modal). */
  onNavigate?: () => void;
  /**
   * Pick mode: choosing a result calls this instead of navigating (e.g. "add
   * to watchlist"). Rows then show "+ Add", or "✓ Added" when isAdded says so.
   */
  onSelect?: (result: SearchResult) => void;
  isAdded?: (result: SearchResult) => boolean;
  /** Mirror what's typed, e.g. to filter a list on the same page. */
  onQueryChange?: (query: string) => void;
  /** Only suggest these instrument types. */
  filterTypes?: InstrumentType[];
  /** Only suggest instruments in this market. */
  market?: Market;
  /** Only suggest instruments on this exchange (NSE, MCX, US…). */
  exchange?: string;
  placeholder?: string;
  inputId?: string;
  ariaLabel?: string;
  /** Marks the field invalid (a form couldn't accept what's there). */
  invalid?: boolean;
  /** id of the element explaining the field, e.g. a validation message. */
  describedBy?: string;
}) {
  const router = useRouter();
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [recent, setRecent] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(-1);
  const [attempt, setAttempt] = useState(0);
  const [partial, setPartial] = useState(false);

  const trimmed = query.trim();
  const showingRecent = !trimmed;
  // "+ Add / ✓ Added" only where the caller tracks what's added (watchlist);
  // a form field's pick is shown by the field itself.
  const pickMode = Boolean(onSelect && isAdded);
  // The server applies the filters; recently viewed items are filtered here.
  const allowed = (result: SearchResult) =>
    (!filterTypes || filterTypes.includes(result.type)) && (!market || result.market === market);
  const list = (showingRecent ? recent : results).filter(allowed);
  const requestLimit = 8;
  const filterKey = filterKeyOf(filterTypes, market, exchange);

  // Debounced search. State changes happen in the timer/fetch callbacks, never
  // synchronously in the effect body.
  useEffect(() => {
    if (!trimmed) return;

    const key = `${trimmed.toLowerCase()}|${requestLimit}|${filterKey}`;
    const cached = cache.get(key);

    const timer = window.setTimeout(
      async () => {
        if (cached) {
          setResults(cached);
          setPartial(false);
          setStatus("ready");
          setActive(cached.length ? 0 : -1);
          return;
        }

        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        setStatus("loading");

        try {
          const filters = filtersFromKey(filterKey);
          const response = await fetch(searchUrl(trimmed, requestLimit, filters), {
            signal: controller.signal,
          });
          const data = await response.json();
          if (controller.signal.aborted) return;

          if (!data?.success) {
            // 400: nothing searchable was typed (only punctuation, or too long).
            setStatus(response.status === 400 ? "invalid" : "error");
            return;
          }

          const found = data.results as SearchResult[];
          // Incomplete answers (a provider was down) aren't cached either.
          if (!data.partial) {
            if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
            cache.set(key, found);
          }
          setResults(found);
          setPartial(Boolean(data.partial));
          setStatus("ready");
          setActive(found.length ? 0 : -1);
        } catch (error) {
          if ((error as { name?: string })?.name === "AbortError") return;
          setStatus("error");
        }
      },
      cached ? 0 : DEBOUNCE_MS
    );

    return () => window.clearTimeout(timer);
  }, [trimmed, attempt, requestLimit, filterKey]);

  // Abort anything in flight when the box goes away.
  useEffect(() => () => controllerRef.current?.abort(), []);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function go(result: SearchResult | undefined) {
    if (!result) return;

    if (onSelect) {
      onSelect(result);
      setQuery("");
      onQueryChange?.("");
      setResults([]);
      setStatus("idle");
      setOpen(false);
      return;
    }

    controllerRef.current?.abort();
    setOpen(false);
    setQuery("");
    setResults([]);
    setStatus("idle");
    inputRef.current?.blur();
    onNavigate?.();
    router.push(result.href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // Home/End move the caret in the text until the list is open.
    const listKey = event.key === "ArrowDown" || event.key === "ArrowUp" || (open && (event.key === "Home" || event.key === "End"));
    const moved = listKey ? nextActiveIndex(event.key, active, list.length) : undefined;
    if (moved !== undefined) {
      event.preventDefault();
      setOpen(true);
      setActive(moved);
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(list[active >= 0 ? active : 0]);
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      } else if (query) {
        setQuery("");
        onQueryChange?.("");
      }
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  const expanded = open && (showingRecent ? recent.length > 0 : true);
  const activeId = expanded && active >= 0 && list[active] ? `${listId}-${active}` : undefined;
  const hero = variant === "hero";

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <span aria-hidden="true" className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-[#666] ${hero ? "left-5" : "left-3.5"}`}>
          ⌕
        </span>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          id={inputId}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            onQueryChange?.(next);
            setOpen(true);
            setActive(-1);
            if (!next.trim()) {
              controllerRef.current?.abort();
              setResults([]);
              setStatus("idle");
            }
          }}
          onFocus={() => {
            setRecent(recentAsResults(getRecentlyViewed()));
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className={`w-full border ${invalid ? "border-[#f87171]/70" : "border-[#222]"} bg-[#111] text-white outline-none transition-colors placeholder:text-[#666] focus:border-green-500 focus:ring-1 focus:ring-green-500 ${
            hero ? "rounded-2xl py-4 pl-11 pr-5 text-base" : "rounded-xl py-2.5 pl-9 pr-3 text-sm"
          }`}
        />
        {status === "loading" && trimmed && (
          <span
            aria-hidden="true"
            className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-[#333] border-t-[#22c55e] ${hero ? "right-5" : "right-3"}`}
          />
        )}
      </div>

      {expanded && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-[#222] bg-[#111] text-left shadow-2xl">
          {showingRecent && (
            <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#666]">Recently viewed</p>
          )}

          {!showingRecent && status === "error" && (
            <div role="status" className="flex items-center justify-between gap-3 px-4 py-4 text-sm text-[#888]">
              Search isn&apos;t responding right now.
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="rounded-lg border border-[#2a2a2a] px-3 py-1 text-xs font-semibold text-white hover:bg-[#1a1a1a]"
              >
                Retry
              </button>
            </div>
          )}

          {!showingRecent && status === "invalid" && (
            <p role="status" className="px-4 py-4 text-sm text-[#888]">
              Type a company name or ticker, e.g. SBI or AAPL.
            </p>
          )}

          {!showingRecent && status === "loading" && results.length === 0 && (
            <div role="status" aria-label="Searching" className="space-y-2 p-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-11 animate-pulse rounded-lg bg-[#161616]" />
              ))}
            </div>
          )}

          {!showingRecent && status === "ready" && list.length === 0 && (
            <p role="status" className="px-4 py-4 text-sm text-[#888]">
              No matches for “{trimmed}”. Try a ticker like TCS or AAPL, or a company name.
            </p>
          )}

          {list.length > 0 && status !== "error" && status !== "invalid" && (
            <ul id={listId} role="listbox" aria-label={showingRecent ? "Recently viewed" : "Search results"} className="max-h-[60vh] overflow-y-auto py-1">
              {list.map((result, index) => (
                <li
                  key={result.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => go(result)}
                  onMouseMove={() => setActive(index)}
                  className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 ${index === active ? "bg-[#1a1a1a]" : ""}`}
                >
                  <StockAvatar symbol={result.symbol} size={32} market={result.market} type={result.type} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-[#d4d4d4]">
                      <Highlight text={result.name} query={trimmed} />
                    </span>
                    <span className="block truncate text-xs text-[#777]">
                      <span className="font-mono text-[#bbb]">
                        <Highlight text={result.symbol} query={trimmed} />
                      </span>{" "}
                      · {result.exchange} · <span className={TYPE_STYLE[result.type]}>{assetLabel(result)}</span>
                    </span>
                  </span>
                  {pickMode &&
                    (isAdded?.(result) ? (
                      <span className="shrink-0 text-xs font-medium text-[#777]">✓ Added</span>
                    ) : (
                      <span className="shrink-0 rounded-lg border border-[#22c55e]/50 px-2 py-0.5 text-xs font-semibold text-[#4ade80]">
                        + Add
                      </span>
                    ))}
                </li>
              ))}
            </ul>
          )}

          {!showingRecent && status === "ready" && partial && (
            <p className="border-t border-[#1d1d1d] px-4 py-2 text-[11px] text-[#666]">
              Some sources didn&apos;t answer, so results may be incomplete.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
