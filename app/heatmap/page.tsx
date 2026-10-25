"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { StockAvatar } from "@/components/Markets/StockBits";
import { DetailRows, HeatmapLegend, HeatmapTreemap, type TileInfo } from "@/components/Markets/HeatmapTreemap";
import { EmptyState, PageHeader, PageShell } from "@/components/ui/Page";
import { METRICS, metricUnavailableReason, type MetricGroup, type MetricId, type MetricSource } from "@/lib/analytics/heatmapMetrics";
import {
  GROUPING_LABELS,
  SIZE_LABELS,
  buildView,
  formatExchangeTime,
  metricDef,
  metricValue,
  searchTiles,
  type Grouping,
  type MetricValues,
  type SizeBy,
} from "@/lib/analytics/heatmapView";
import { formatQuotePrice } from "@/lib/client/useMarketOverview";
import type { HeatmapData, HeatmapTile, HeatmapUniverse } from "@/lib/services/heatmap";
import type { HeatmapMetrics } from "@/lib/services/heatmapMetrics";

/**
 * Market Heatmap, laid out like TradingView's stock heatmap. Data:
 *   /api/market/heatmap           quotes, sector/industry, market cap
 *   /api/market/heatmap/metrics   one batched set of colour metrics
 * Every number comes from a provider; anything missing is shown as missing.
 */

const UNIVERSE_OPTIONS: { id: HeatmapUniverse; label: string; group: string }[] = [
  { id: "nifty50", label: "NIFTY 50", group: "India · NSE" },
  { id: "niftynext50", label: "NIFTY Next 50", group: "India · NSE" },
  { id: "nifty100", label: "NIFTY 100", group: "India · NSE" },
  { id: "nifty200", label: "NIFTY 200", group: "India · NSE" },
  { id: "nifty500", label: "NIFTY 500", group: "India · NSE" },
  { id: "niftymidcap100", label: "NIFTY Midcap 100", group: "India · NSE" },
  { id: "niftysmallcap100", label: "NIFTY Smallcap 100", group: "India · NSE" },
  { id: "niftybank", label: "NIFTY Bank", group: "India · NSE" },
  { id: "niftyit", label: "NIFTY IT", group: "India · NSE" },
  { id: "us", label: "US large caps (20)", group: "United States" },
];

const fmtPrice = (value: number | null, currency: string | null) => (value !== null && currency ? formatQuotePrice(value, currency) : "—");

const METRIC_GROUPS: MetricGroup[] =["Short-term", "Performance", "Trading session", "Activity", "Risk"];

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

async function getJson<T>(url: string): Promise<Load<T>> {
  try {
    const response = await fetch(url);
    const body = await response.json().catch(() => null);
    if (response.ok && body?.success) return { status: "ready", data: body as T };
    return { status: "error", message: typeof body?.error === "string" ? body.error : "Data is unavailable right now." };
  } catch {
    return { status: "error", message: "Couldn't reach the server." };
  }
}

/** The universe's base data; asks again every 3s while market caps are still loading. */
function useBase(universe: HeatmapUniverse) {
  const [attempt, setAttempt] = useState(0);
  const key = `${universe}:${attempt}`;
  const [result, setResult] = useState<{ key: string; load: Load<HeatmapData> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const run = async () => {
      const load = await getJson<HeatmapData>(`/api/market/heatmap?universe=${universe}`);
      if (cancelled) return;
      // A failed poll keeps the data already on screen.
      setResult((prev) => (load.status === "error" && prev?.key === key && prev.load.status === "ready" ? prev : { key, load }));
      if (load.status === "ready" && load.data.capsPending > 0 && polls++ < 40) timer = setTimeout(run, 3_000);
    };
    run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [universe, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return [result && result.key === key ? result.load : ({ status: "loading" } as const), retry] as const;
}

/** One batched metric set for the universe; null source = nothing to fetch. */
function useMetricSet(universe: HeatmapUniverse, source: Exclude<MetricSource, "base"> | null) {
  const [attempt, setAttempt] = useState(0);
  const key = source ? `${universe}:${source}:${attempt}` : null;
  const [result, setResult] = useState<{ key: string; load: Load<HeatmapMetrics> } | null>(null);

  useEffect(() => {
    if (!key || !source) return;
    let cancelled = false;
    getJson<HeatmapMetrics>(`/api/market/heatmap/metrics?universe=${universe}&set=${source}`).then((load) => {
      if (!cancelled) setResult({ key, load });
    });
    return () => {
      cancelled = true;
    };
  }, [universe, source, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const load: Load<HeatmapMetrics> | null = !key ? null : result && result.key === key ? result.load : { status: "loading" };
  return [load, retry] as const;
}

function Select({ id, label, value, onChange, children }: { id: string; label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <label htmlFor={id} className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-[#787b86]">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full min-w-0 rounded-md border border-[#2a2e39] bg-[#131722] px-2 text-sm text-[#d1d4dc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
      >
        {children}
      </select>
    </label>
  );
}

function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <p className={`mb-2 rounded-md border px-3 py-2 text-xs ${tone === "warn" ? "border-[#5c4a1f] bg-[#2a2210] text-[#e0c27a]" : "border-[#2a2e39] bg-[#131722] text-[#9598a1]"}`}>
      {children}
    </p>
  );
}

function SymbolList({ title, tiles }: { title: string; tiles: HeatmapTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <div className="mt-3 rounded-md border border-[#2a2e39] bg-[#131722] px-3 py-2 text-xs text-[#9598a1]">
      <p className="mb-1 font-medium text-[#d1d4dc]">
        {title} ({tiles.length})
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {tiles.map((t) => (
          <Link key={t.symbol} href={`/stock/${encodeURIComponent(t.href)}`} className="hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/50">
            {t.symbol}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function HeatmapPage() {
  const [universe, setUniverse] = useState<HeatmapUniverse>("nifty50");
  const [sizeBy, setSizeBy] = useState<SizeBy>("marketCap");
  const [metricId, setMetricId] = useState<MetricId>("chg1d");
  const [grouping, setGrouping] = useState<Grouping>("sector");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const [base, retryBase] = useBase(universe);
  const data = base.status === "ready" ? base.data : null;
  const tiles = useMemo(() => data?.tiles ?? [], [data]);
  const market = UNIVERSE_OPTIONS.find((u) => u.id === universe)?.group === "United States" ? "US" : "India";

  // A metric the universe can't support falls back to 1D change, with a note.
  const requested = metricDef(metricId);
  const unavailable = data ? metricUnavailableReason(requested, market, tiles.length) : null;
  const def = unavailable ? metricDef("chg1d") : requested;
  const [metrics, retryMetrics] = useMetricSet(universe, data && def.source !== "base" ? def.source : null);
  const values: MetricValues | null = metrics?.status === "ready" ? metrics.data.values : null;

  const groupingOk = (g: Grouping) => g === "none" || (data ? (g === "sector" ? data.sector.available : data.industry.available) : false);
  const effectiveGrouping: Grouping = groupingOk(grouping) ? grouping : "none";

  const view = useMemo(() => buildView(tiles, sizeBy, effectiveGrouping), [tiles, sizeBy, effectiveGrouping]);
  const infos = useMemo(() => new Map<string, TileInfo>(tiles.map((tile) => [tile.symbol, { tile, metric: metricValue(tile, def.id, values) }])), [tiles, def.id, values]);
  const matches = useMemo(() => searchTiles(tiles, query), [tiles, query]);
  const highlight = useMemo(() => (query.trim() ? new Set(searchTiles(tiles, query, tiles.length).map((t) => t.symbol)) : null), [tiles, query]);
  const inspected = selected ? infos.get(selected) ?? null : null;

  const capsLoading = sizeBy === "marketCap" && (data?.capsPending ?? 0) > 0;
  const priced = tiles.filter((t) => t.price !== null).length;
  const sized = view.groups.reduce((s, g) => s + g.items.length, 0);
  const withMetric = [...infos.values()].filter((i) => i.tile.price !== null && i.metric !== null).length;

  const sourceNote = useCallback(
    (tile: HeatmapTile) => {
      if (!data) return "";
      const parts = [
        `Price: ${tile.priceSource ?? data.priceSource}${tile.quoteTime ? `, as of ${formatExchangeTime(tile.quoteTime, tile.market)}` : `, fetched ${formatExchangeTime(data.fetchedAt, tile.market)}`}`,
        `Cap: ${data.capSource}${tile.sharesAsOf ? ` (shares as of ${tile.sharesAsOf})` : ""}`,
      ];
      if (def.source !== "base" && metrics?.status === "ready") parts.push(`${def.label}: ${metrics.data.source}, fetched ${formatExchangeTime(metrics.data.fetchedAt, tile.market)}`);
      return parts.join(" · ");
    },
    [data, def, metrics]
  );

  const changeUniverse = (value: string) => {
    setUniverse(value as HeatmapUniverse);
    setSelected(null);
    setQuery("");
  };

  return (
    <PageShell>
      <PageHeader eyebrow="Heatmap" title="Market heatmap" description={`Size: ${SIZE_LABELS[sizeBy].toLowerCase()}. Colour: ${def.label}. Hover or focus a tile for details; click to open the stock.`} />

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select id="hm-universe" label="Universe" value={universe} onChange={changeUniverse}>
          {["India · NSE", "United States"].map((group) => (
            <optgroup key={group} label={group}>
              {UNIVERSE_OPTIONS.filter((u) => u.group === group).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <Select id="hm-size" label="Size by" value={sizeBy} onChange={(v) => setSizeBy(v as SizeBy)}>
          {(Object.keys(SIZE_LABELS) as SizeBy[]).map((s) => (
            <option key={s} value={s}>
              {SIZE_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select id="hm-color" label="Colour by" value={def.id}onChange={(v) => setMetricId(v as MetricId)}>
          {METRIC_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {METRICS.filter((m) => m.group === group).map((m) => {
                const reason = data ? metricUnavailableReason(m, market, tiles.length) : null;
                return (
                  <option key={m.id} value={m.id} disabled={reason !== null}>
                    {m.label}
                    {reason ? " — n/a" : ""}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </Select>
        <Select id="hm-group" label="Group by" value={effectiveGrouping} onChange={(v) => setGrouping(v as Grouping)}>
          {(Object.keys(GROUPING_LABELS) as Grouping[]).map((g) => (
            <option key={g} value={g} disabled={!groupingOk(g)}>
              {GROUPING_LABELS[g]}
              {!groupingOk(g) && data ? " — n/a" : ""}
            </option>
          ))}
        </Select>
      </div>

      <div className="relative mb-3">
        <label htmlFor="hm-search" className="sr-only">
          Find a stock in this heatmap
        </label>
        <input
          id="hm-search"
          type="search"
          value={query}
          placeholder="Find a stock (symbol or name)…"
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches[0]) {
              setSelected(matches[0].symbol);
              setQuery("");
            } else if (e.key === "Escape") setQuery("");
          }}
          className="h-9 w-full rounded-md border border-[#2a2e39] bg-[#131722] px-3 text-sm text-[#d1d4dc] placeholder:text-[#5d606b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        />
        {query.trim() !== "" && (
          <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-[#2a2e39] bg-[#1e222d] py-1 text-sm shadow-xl" aria-label="Matching stocks">
            {matches.length === 0 && <li className="px-3 py-2 text-xs text-[#787b86]">No stock in {data?.label ?? "this universe"} matches.</li>}
            {matches.map((t) => (
              <li key={t.symbol}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(t.symbol);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[#2a2e39] focus-visible:bg-[#2a2e39] focus-visible:outline-none"
                >
                  <span className="font-semibold text-white">{t.symbol}</span>
                  <span className="truncate text-xs text-[#9598a1]">{t.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {unavailable && <Note tone="warn">{unavailable} Showing 1D change instead.</Note>}
      {data && grouping !== effectiveGrouping && (
        <Note tone="warn">
          {GROUPING_LABELS[grouping]} grouping isn&apos;t available for {data.label}: {grouping === "sector" && !data.sector.available ? data.sector.reason : !data.industry.available ? data.industry.reason : ""} Showing a flat map.
        </Note>
      )}
      <p className="mb-3 text-[11px] leading-relaxed text-[#787b86]">
        <span className="font-medium text-[#9598a1]">{def.label}:</span> {def.definition}
      </p>

      {base.status === "loading" && (
        <div role="status" aria-live="polite" className="flex h-[520px] w-full animate-pulse items-center justify-center rounded-md bg-[#131722] text-xs text-[#787b86] motion-reduce:animate-none">
          Loading {UNIVERSE_OPTIONS.find((u) => u.id === universe)?.label} constituents and prices…
        </div>
      )}

      {base.status === "error" && (
        <EmptyState
          icon="📡"
          title="This heatmap is unavailable right now"
          description={base.message}
          action={
            <button type="button" onClick={retryBase} className="rounded-lg border border-[#333] px-4 py-2 text-sm hover:bg-[#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
              Try again
            </button>
          }
        />
      )}

      {data && (
        <>
          {metrics?.status === "loading" && (
            <p role="status" aria-live="polite" className="mb-2 text-xs text-[#9598a1]">
              Loading {def.label} for {data.label}… tiles show “No data” until it arrives.
            </p>
          )}
          {metrics?.status === "error" && (
            <Note tone="warn">
              {def.label} couldn&apos;t be loaded: {metrics.message}{" "}
              <button type="button" onClick={retryMetrics} className="underline hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/50">
                Try again
              </button>
            </Note>
          )}

          {inspected && (
            <section aria-label={`Details for ${inspected.tile.symbol}`} className="mb-3 rounded-md border border-[#2a2e39] bg-[#131722] p-3 text-xs text-[#d1d4dc]">
              <div className="mb-2 flex items-center gap-2">
                <StockAvatar symbol={inspected.tile.href} market={inspected.tile.market} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white">{inspected.tile.symbol}</p>
                  <p className="truncate text-[#9598a1]">{inspected.tile.name ?? "—"}</p>
                </div>
                <button type="button" onClick={() => setSelected(null)} aria-label="Close details" className="rounded px-2 py-1 text-[#9598a1] hover:bg-[#2a2e39] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
                  ✕
                </button>
              </div>
              <DetailRows info={inspected} def={def} />
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 tabular-nums">
                <dt className="text-[#9598a1]">Market cap (exact)</dt>
                <dd className="text-right">{inspected.tile.marketCap !== null ? `${inspected.tile.currency === "INR" ? "₹" : "$"}${inspected.tile.marketCap.toLocaleString(inspected.tile.currency === "INR" ? "en-IN" : "en-US")}` : "—"}</dd>
                <dt className="text-[#9598a1]">Volume today</dt>
                <dd className="text-right">{inspected.tile.volume !== null ? inspected.tile.volume.toLocaleString() : "—"}</dd>
                <dt className="text-[#9598a1]">Open / prev. close</dt>
                <dd className="text-right">
                  {fmtPrice(inspected.tile.open, inspected.tile.currency)} / {fmtPrice(inspected.tile.previousClose, inspected.tile.currency)}
                </dd>
              </dl>
              <p className="mt-2 border-t border-[#2a2e39] pt-2 text-[10px] text-[#787b86]">{sourceNote(inspected.tile)}</p>
              <Link href={`/stock/${encodeURIComponent(inspected.tile.href)}`} className="mt-2 inline-block rounded-md border border-[#2a2e39] px-3 py-1.5 text-[#d1d4dc] hover:bg-[#2a2e39] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
                Open {inspected.tile.symbol} →
              </Link>
            </section>
          )}

          {capsLoading ? (
            <div role="status" aria-live="polite" className="flex h-[440px] flex-col items-center justify-center gap-3 rounded-md bg-[#131722] px-4 text-center text-xs text-[#9598a1]">
              <p>
                Loading market caps: {priced - data.capsPending} of {priced} ready (one Yahoo lookup per stock, cached for 6 hours).
              </p>
              <button type="button" onClick={() => setSizeBy("equal")} className="rounded-md border border-[#2a2e39] px-3 py-1.5 text-[#d1d4dc] hover:bg-[#2a2e39] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
                Show equal-sized tiles meanwhile
              </button>
            </div>
          ) : sized === 0 ? (
            <EmptyState icon="▦" title="Nothing to size" description={`No stock in ${data.label} has a ${SIZE_LABELS[sizeBy].toLowerCase()} figure right now. Try another Size option.`} />
          ) : (
            <HeatmapTreemap infos={infos} groups={view.groups} flat={effectiveGrouping === "none"} def={def} highlight={highlight} selected={selected} sourceNote={sourceNote} />
          )}
          <HeatmapLegend def={def} />

          <p className="mt-3 text-center text-[11px] text-[#787b86]">
            {sized} of {tiles.length} stocks on the map · {withMetric} with {def.label} data · Constituents: {data.constituentSource} · Prices: {data.priceSource}, fetched{" "}
            {formatExchangeTime(data.fetchedAt, data.market)}
            {effectiveGrouping !== "none" && ` · ${GROUPING_LABELS[effectiveGrouping]}: ${effectiveGrouping === "sector" && data.sector.available ? data.sector.source : data.industry.available ? data.industry.source : ""}`}
          </p>

          {sizeBy !== "equal" && <SymbolList title={`Not sized — ${SIZE_LABELS[sizeBy].toLowerCase()} unavailable`} tiles={view.unsized} />}
          <SymbolList title="Quote unavailable" tiles={view.unpriced} />

          <details className="mt-4 rounded-md border border-[#2a2e39] bg-[#131722] px-3 py-2 text-xs text-[#9598a1]">
            <summary className="cursor-pointer text-[#d1d4dc] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/50">How every metric is defined, and what&apos;s unavailable here</summary>
            <ul className="mt-2 space-y-2">
              {METRICS.map((m) => {
                const reason = metricUnavailableReason(m, market, tiles.length);
                return (
                  <li key={m.id}>
                    <span className="font-medium text-[#d1d4dc]">{m.label}</span> <span className="text-[#5d606b]">({m.group})</span>
                    {reason ? <span className="text-[#e0c27a]"> — unavailable: {reason}</span> : null}
                    <br />
                    {m.definition}
                  </li>
                );
              })}
              <li>
                <span className="font-medium text-[#d1d4dc]">Times</span> are exchange time: IST (Asia/Kolkata) for NSE, ET (America/New_York) for US. Weekends and exchange holidays have no bars, so a period that starts on one uses the last trading day before it.
              </li>
              <li>
                <span className="font-medium text-[#d1d4dc]">% change vs performance:</span> 1D/1h/4h and session changes compare against a price earlier in the trading day or the previous close; Perf metrics are total price performance over the whole period from a daily close.
              </li>
            </ul>
          </details>
        </>
      )}
    </PageShell>
  );
}

