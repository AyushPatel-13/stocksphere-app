import { divergingStops, type ColorStop, type TreemapGroup } from "./heatmap";
import { METRIC_BY_ID, type MetricDef, type MetricId } from "./heatmapMetrics";
import type { HeatmapTile } from "../services/heatmap";
import type { MetricValue } from "../services/heatmapMetrics";

/**
 * Pure view logic for the Heatmap page: what each selector combination puts
 * on the map. Kept out of the component so selector changes are testable.
 */

export type SizeBy = "marketCap" | "equal" | "volume";
export type Grouping = "sector" | "industry" | "none";

export const SIZE_LABELS: Record<SizeBy, string> = { marketCap: "Market cap", equal: "Equal", volume: "Volume (today)" };
export const GROUPING_LABELS: Record<Grouping, string> = { sector: "Sector", industry: "Industry", none: "None (flat)" };

export type MetricValues = Record<string, Partial<Record<MetricId, MetricValue | null>>>;

/** A tile's value for the selected metric, with its window; null when missing. */
export function metricValue(tile: HeatmapTile, metric: MetricId, values: MetricValues | null): MetricValue | null {
  if (metric === "chg1d") return tile.changePercent !== null ? { value: tile.changePercent, from: "previous close", to: "latest price" } : null;
  if (metric === "gap") return tile.gap !== null ? { value: tile.gap, from: "previous close", to: "today's open" } : null;
  return values?.[tile.symbol]?.[metric] ?? null;
}

export function sizeValue(tile: HeatmapTile, sizeBy: SizeBy): number | null {
  if (tile.price === null) return null;
  if (sizeBy === "equal") return 1;
  const v = sizeBy === "marketCap" ? tile.marketCap : tile.volume;
  return v !== null && v > 0 ? v : null;
}

export const UNCLASSIFIED = "Unclassified";

export type HeatmapView = {
  groups: TreemapGroup[];
  /** Priced stocks that can't be sized by the chosen metric. */
  unsized: HeatmapTile[];
  /** Stocks with no quote at all. */
  unpriced: HeatmapTile[];
};

/**
 * Groups and sizes for the map. Every sized stock lands in exactly one group:
 * its own sector/industry, or "Unclassified" when the source gave none —
 * never a guessed one. Groups are ordered by total size.
 */
export function buildView(tiles: readonly HeatmapTile[], sizeBy: SizeBy, grouping: Grouping): HeatmapView {
  const unpriced: HeatmapTile[] = [];
  const unsized: HeatmapTile[] = [];
  const byGroup = new Map<string, { id: string; value: number }[]>();
  for (const tile of tiles) {
    if (tile.price === null) {
      unpriced.push(tile);
      continue;
    }
    const value = sizeValue(tile, sizeBy);
    if (value === null) {
      unsized.push(tile);
      continue;
    }
    const key = grouping === "none" ? "" : (grouping === "sector" ? tile.sector : tile.industry) ?? UNCLASSIFIED;
    const list = byGroup.get(key) ?? [];
    list.push({ id: tile.symbol, value });
    byGroup.set(key, list);
  }
  const groups = [...byGroup.entries()]
    .map(([label, items]) => ({ id: label || "all", label, items, total: items.reduce((s, i) => s + i.value, 0) }))
    .sort((a, b) => b.total - a.total)
    .map(({ id, label, items }) => ({ id, label, items }));
  return { groups, unsized, unpriced };
}

/** Case-insensitive symbol/name match; symbol-prefix matches first. */
export function searchTiles(tiles: readonly HeatmapTile[], query: string, limit = 8): HeatmapTile[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored = tiles.flatMap((t) => {
    const sym = t.symbol.toLowerCase();
    const name = (t.name ?? "").toLowerCase();
    const score = sym === q ? 0 : sym.startsWith(q) ? 1 : sym.includes(q) ? 2 : name.includes(q) ? 3 : -1;
    return score < 0 ? [] : [{ t, score }];
  });
  return scored.sort((a, b) => a.score - b.score || a.t.symbol.localeCompare(b.t.symbol)).slice(0, limit).map((s) => s.t);
}

/* ------------------------------------------------------------ format */

export function formatMetric(value: number | null, def: MetricDef): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (def.unit === "×") return `${value.toFixed(2)}×`;
  if (def.scale.kind === "sequential") return `${value.toFixed(2)}%`;
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function scaleStops(def: MetricDef): ColorStop[] {
  return def.scale.kind === "diverging" ? divergingStops(def.scale.cap) : [...def.scale.stops];
}

const trim = (n: number) => String(Number(n.toFixed(2)));

/** Legend swatches for a metric: colour and label at each stop, ends marked as caps. */
export function legendFor(def: MetricDef): { color: string; label: string }[] {
  const stops = scaleStops(def);
  return stops.map((s, i) => {
    const base = def.unit === "×" ? `${trim(s.at)}×` : `${def.scale.kind === "diverging" && s.at > 0 ? "+" : ""}${trim(s.at)}%`;
    const label = i === 0 && def.scale.kind === "sequential" ? `≤${base}` : i === stops.length - 1 && def.scale.kind === "sequential" ? `≥${base}` : base;
    return { color: s.color, label };
  });
}

export const EXCHANGE_TZ: Record<"India" | "US", { zone: string; label: string }> = {
  India: { zone: "Asia/Kolkata", label: "IST" },
  US: { zone: "America/New_York", label: "ET" },
};

/** "19 Oct, 15:29 IST" for an ISO instant; date-only strings pass through. */
export function formatExchangeTime(value: string | null, market: "India" | "US"): string {
  if (!value) return "—";
  if (!value.includes("T")) return value;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  const { zone, label } = EXCHANGE_TZ[market];
  const text = new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);
  return `${text} ${label}`;
}

export function metricDef(id: MetricId): MetricDef {
  return METRIC_BY_ID.get(id)!;
}
