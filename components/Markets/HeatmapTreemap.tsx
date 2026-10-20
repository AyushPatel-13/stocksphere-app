"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { StockAvatar } from "@/components/Markets/StockBits";
import { NO_DATA_COLOR, colorFor, formatMarketCap, groupedTreemap, squarify, type ColorStop, type TreemapCell, type TreemapGroup } from "@/lib/analytics/heatmap";
import type { MetricDef } from "@/lib/analytics/heatmapMetrics";
import { formatExchangeTime, formatMetric, legendFor, metricDef, scaleStops } from "@/lib/analytics/heatmapView";
import { formatQuotePrice } from "@/lib/client/useMarketOverview";
import type { HeatmapTile } from "@/lib/services/heatmap";
import type { MetricValue } from "@/lib/services/heatmapMetrics";

/**
 * TradingView-style stock heatmap: a squarified treemap (area from the chosen
 * sizing metric), grouped under sector/industry headings when asked, coloured
 * by the chosen metric. Tiles are links to the stock page; hovering or
 * focusing one shows its details.
 */

const GAP = 1;
const HEADER = 18;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Taller than wide on phones so tiles stay readable; ~16:9 on desktop; taller for big universes. */
function mapHeight(width: number, count: number) {
  const extra = count > 150 ? 1.25 : 1;
  if (width < 640) return Math.round(Math.max(520, width * 1.55 * extra));
  return Math.round(Math.min(860, Math.max(440, width * 0.56 * extra)));
}

export type TileInfo = { tile: HeatmapTile; metric: MetricValue | null };

const Tile = memo(function Tile({
  info,
  cell,
  def,
  color,
  dimmed,
  selected,
  onShow,
  onHide,
}: {
  info: TileInfo;
  cell: TreemapCell;
  def: MetricDef;
  color: string;
  dimmed: boolean;
  selected: boolean;
  onShow: (info: TileInfo, x: number, y: number) => void;
  onHide: () => void;
}) {
  const { tile, metric } = info;
  const w = Math.max(0, cell.w - GAP);
  const h = Math.max(0, cell.h - GAP);
  const short = Math.min(w, h);
  const showText = w >= 34 && h >= 22;
  const showValue = w >= 42 && h >= 34;
  const showLogo = w >= 64 && h >= 76;
  const tickerSize = Math.max(10, Math.min(28, short * 0.2));
  const logoSize = Math.round(Math.max(20, Math.min(48, short * 0.28)));
  const valueText = formatMetric(metric?.value ?? null, def);

  return (
    <Link
      href={`/stock/${encodeURIComponent(tile.href)}`}
      aria-label={`${tile.symbol}${tile.name ? `, ${tile.name}` : ""}: ${def.label} ${valueText}, market cap ${formatMarketCap(tile.marketCap, tile.currency)}`}
      onMouseEnter={(e) => onShow(info, e.clientX, e.clientY)}
      onMouseMove={(e) => onShow(info, e.clientX, e.clientY)}
      onMouseLeave={onHide}
      onFocus={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onShow(info, r.left + r.width / 2, r.top + r.height / 2);
      }}
      onBlur={onHide}
      className={`absolute flex flex-col items-center justify-center overflow-hidden text-center leading-tight text-white outline-none transition-opacity hover:brightness-110 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white motion-reduce:transition-none ${
        selected ? "z-10 ring-2 ring-inset ring-[#ffeb3b]" : ""
      }`}
      style={{ left: cell.x, top: cell.y, width: w, height: h, background: color, opacity: dimmed ? 0.22 : 1 }}
    >
      {showLogo && (
        <span className="mb-1">
          <StockAvatar symbol={tile.href} market={tile.market} size={logoSize} />
        </span>
      )}
      {showText && (
        <span className="max-w-full truncate px-0.5 font-semibold" style={{ fontSize: tickerSize }}>
          {tile.symbol}
        </span>
      )}
      {showValue && (
        <span className="tabular-nums text-white/90" style={{ fontSize: Math.max(9, tickerSize * 0.72) }}>
          {valueText}
        </span>
      )}
    </Link>
  );
});

export function DetailRows({ info, def }: { info: TileInfo; def: MetricDef }) {
  const { tile, metric } = info;
  const changeColor = tile.changePercent === null ? undefined : tile.changePercent >= 0 ? "#4ade80" : "#f87171";
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 tabular-nums">
      <dt className="text-[#9598a1]">Price</dt>
      <dd className="text-right">{tile.price !== null && tile.currency ? formatQuotePrice(tile.price, tile.currency) : "—"}</dd>
      <dt className="text-[#9598a1]">1D change</dt>
      <dd className="text-right" style={{ color: changeColor }}>
        {tile.change !== null ? `${tile.change >= 0 ? "+" : ""}${tile.change.toFixed(2)} ` : ""}({formatMetric(tile.changePercent, metricDef("chg1d"))})
      </dd>
      {def.id !== "chg1d" && (
        <>
          <dt className="text-[#9598a1]">{def.label}</dt>
          <dd className="text-right">{formatMetric(metric?.value ?? null, def)}</dd>
        </>
      )}
      {metric && (
        <>
          <dt className="text-[#9598a1]">Window</dt>
          <dd className="text-right text-[11px]">
            {formatExchangeTime(metric.from, tile.market)} → {formatExchangeTime(metric.to, tile.market)}
          </dd>
        </>
      )}
      <dt className="text-[#9598a1]">Market cap</dt>
      <dd className="text-right">{formatMarketCap(tile.marketCap, tile.currency)}</dd>
      {(tile.sector || tile.industry) && (
        <>
          <dt className="text-[#9598a1]">{tile.sector ? "Sector" : "Industry"}</dt>
          <dd className="truncate text-right">{tile.sector ?? tile.industry}</dd>
        </>
      )}
    </dl>
  );
}

export function HeatmapTreemap({
  infos,
  groups,
  flat,
  def,
  highlight,
  selected,
  sourceNote,
}: {
  infos: ReadonlyMap<string, TileInfo>;
  groups: TreemapGroup[];
  flat: boolean;
  def: MetricDef;
  /** Symbols matching the search; others are dimmed. Null = no search. */
  highlight: ReadonlySet<string> | null;
  selected: string | null;
  sourceNote: (tile: HeatmapTile) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const count = groups.reduce((s, g) => s + g.items.length, 0);
  const height = mapHeight(width, count);
  const [tooltip, setTooltip] = useState<{ info: TileInfo; x: number; y: number } | null>(null);
  const stops: ColorStop[] = useMemo(() => scaleStops(def), [def]);

  // The tooltip is fixed-positioned, so a scroll would leave it stranded.
  useEffect(() => {
    if (!tooltip) return;
    const hide = () => setTooltip(null);
    window.addEventListener("scroll", hide, { passive: true, once: true });
    return () => window.removeEventListener("scroll", hide);
  }, [tooltip]);

  const layout = useMemo(() => {
    if (width === 0) return [];
    const rect = { x: 0, y: 0, w: width, h: height };
    if (flat) {
      const items = groups.flatMap((g) => g.items);
      return [{ id: "all", label: "", x: 0, y: 0, w: width, h: height, header: 0, cells: squarify(items, rect) }];
    }
    return groupedTreemap(groups, rect, HEADER, 1);
  }, [groups, flat, width, height]);


  const onShow = useCallback((info: TileInfo, x: number, y: number) => setTooltip({ info, x, y }), []);
  const onHide = useCallback(() => setTooltip(null), []);

  return (
    <div>
      <div ref={ref} className="relative w-full overflow-hidden rounded-md bg-[#0b0e14]" style={{ height }}>
        {layout.map((group) => (
          <div key={group.id}>
            {group.header > 0 && (
              <div
                className="absolute truncate px-1.5 text-[11px] font-semibold uppercase leading-[18px] tracking-wide text-[#d1d4dc]"
                style={{ left: group.x, top: group.y, width: group.w, height: group.header }}
                title={group.label}
              >
                {group.label}
              </div>
            )}
            {group.cells.map((cell) => {
              const info = infos.get(cell.id);
              return info ? (
                <Tile
                  key={cell.id}
                  info={info}
                  cell={cell}
                  def={def}
                  color={colorFor(info.metric?.value ?? null, stops)}
                  dimmed={highlight !== null && !highlight.has(cell.id)}
                  selected={selected === cell.id}
                  onShow={onShow}
                  onHide={onHide}
                />
              ) : null;
            })}
          </div>
        ))}
      </div>

      {tooltip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 w-64 rounded-md border border-[#2a2e39] bg-[#1e222d] p-3 text-xs text-[#d1d4dc] shadow-xl"
          style={{
            left: Math.max(4, Math.min(tooltip.x + 14, (typeof window !== "undefined" ? window.innerWidth : 9999) - 264)),
            top: Math.max(4, Math.min(tooltip.y + 14, (typeof window !== "undefined" ? window.innerHeight : 9999) - 250)),
          }}
        >
          <div className="mb-2 flex items-center gap-2">
            <StockAvatar symbol={tooltip.info.tile.href} market={tooltip.info.tile.market} size={28} />
            <div className="min-w-0">
              <p className="font-semibold text-white">{tooltip.info.tile.symbol}</p>
              <p className="truncate text-[#9598a1]">{tooltip.info.tile.name ?? "—"}</p>
            </div>
          </div>
          <DetailRows info={tooltip.info} def={def} />
          <p className="mt-2 border-t border-[#2a2e39] pt-2 text-[10px] leading-snug text-[#787b86]">{sourceNote(tooltip.info.tile)}</p>
        </div>
      )}
    </div>
  );
}

/** The colour bar under the map, for the selected metric, as on TradingView. */
export function HeatmapLegend({ def }: { def: MetricDef }) {
  const items = legendFor(def);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-2" aria-label={`Colour scale for ${def.label}: ${items.map((i) => i.label).join(", ")}; grey-blue means no data`}>
      <div className="flex overflow-hidden rounded-sm text-[11px] font-medium tabular-nums text-white">
        {items.map((item) => (
          <span key={item.label} className="flex h-6 w-11 items-center justify-center sm:w-14" style={{ background: item.color }}>
            {item.label}
          </span>
        ))}
      </div>
      <span className="flex h-6 items-center rounded-sm px-2 text-[11px] text-[#9598a1]" style={{ background: NO_DATA_COLOR }}>
        No data
      </span>
    </div>
  );
}
