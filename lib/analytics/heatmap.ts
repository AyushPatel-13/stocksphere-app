/**
 * Pure pieces of the Heatmap page: a squarified treemap layout, the
 * TradingView-style colour scale for a day's % change, and market-cap
 * formatting. No React, no fetching — unit tested in __tests__.
 */

export type Rect = { x: number; y: number; w: number; h: number };
export type TreemapItem = { id: string; value: number };
export type TreemapCell = Rect & { id: string };

/** Worst aspect ratio of a row of areas laid along a side of length `side`. */
function worst(row: number[], side: number): number {
  let sum = 0;
  let max = 0;
  let min = Infinity;
  for (const a of row) {
    sum += a;
    if (a > max) max = a;
    if (a < min) min = a;
  }
  const s2 = side * side;
  const sum2 = sum * sum;
  return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk): each item's rectangle area
 * is proportional to its value and rectangles stay close to square. Items
 * with a non-positive or non-finite value are left out — they have no size,
 * and the caller lists them separately rather than giving them a guessed one.
 * Output is in descending value order.
 */
export function squarify(items: readonly TreemapItem[], rect: Rect): TreemapCell[] {
  const valid = items.filter((item) => Number.isFinite(item.value) && item.value > 0).sort((a, b) => b.value - a.value);
  if (valid.length === 0 || rect.w <= 0 || rect.h <= 0) return [];

  const total = valid.reduce((sum, item) => sum + item.value, 0);
  const scale = (rect.w * rect.h) / total;
  const areas = valid.map((item) => item.value * scale);

  const cells: TreemapCell[] = [];
  let { x, y, w, h } = rect;
  let i = 0;

  while (i < areas.length) {
    const side = Math.min(w, h);
    const row = [areas[i]];
    let j = i + 1;
    while (j < areas.length && worst([...row, areas[j]], side) <= worst(row, side)) {
      row.push(areas[j]);
      j++;
    }

    const rowSum = row.reduce((sum, a) => sum + a, 0);
    const last = j === areas.length;
    if (w >= h) {
      // Column along the left edge.
      const colW = last ? w : rowSum / h;
      let cy = y;
      row.forEach((a, k) => {
        const ch = k === row.length - 1 ? y + h - cy : a / colW;
        cells.push({ id: valid[i + k].id, x, y: cy, w: colW, h: ch });
        cy += ch;
      });
      x += colW;
      w -= colW;
    } else {
      // Row along the top edge.
      const rowH = last ? h : rowSum / w;
      let cx = x;
      row.forEach((a, k) => {
        const cw = k === row.length - 1 ? x + w - cx : a / rowH;
        cells.push({ id: valid[i + k].id, x: cx, y, w: cw, h: rowH });
        cx += cw;
      });
      y += rowH;
      h -= rowH;
    }
    i = j;
  }

  return cells;
}

export type TreemapGroup = { id: string; label: string; items: readonly TreemapItem[] };
export type GroupCell = Rect & { id: string; label: string; header: number; cells: TreemapCell[] };

/**
 * Two-level layout: groups are squarified by their total value, then each
 * group's items fill the group's rectangle below a header strip of
 * `headerHeight` (dropped when the group is too short to spare it).
 */
export function groupedTreemap(groups: readonly TreemapGroup[], rect: Rect, headerHeight = 18, padding = 0): GroupCell[] {
  const totals = groups.map((group) => ({
    id: group.id,
    value: group.items.reduce((sum, item) => sum + (Number.isFinite(item.value) && item.value > 0 ? item.value : 0), 0),
  }));
  const byId = new Map(groups.map((group) => [group.id, group]));

  return squarify(totals, rect).map((cell) => {
    const group = byId.get(cell.id)!;
    const header = cell.h >= headerHeight * 3 && cell.w >= 60 ? headerHeight : 0;
    return {
      ...cell,
      label: group.label,
      header,
      // `padding` insets the items so groups read as separate blocks.
      cells: squarify(group.items, {
        x: cell.x + padding,
        y: cell.y + header + padding,
        w: Math.max(0, cell.w - 2 * padding),
        h: Math.max(0, cell.h - header - 2 * padding),
      }),
    };
  });
}

/* ------------------------------------------------------------ colour */

/** % change → colour stops, matching TradingView's heatmap palette. */
export const CHANGE_COLOR_STOPS: readonly { at: number; color: string }[] = [
  { at: -3, color: "#f63538" },
  { at: -2, color: "#bf4045" },
  { at: -1, color: "#8b444e" },
  { at: 0, color: "#414554" },
  { at: 1, color: "#35764e" },
  { at: 2, color: "#2f9e4f" },
  { at: 3, color: "#30cc5a" },
];

/** Colour for a stock with no change figure. */
export const NO_DATA_COLOR = "#2a2d36";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb: readonly number[]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

export type ColorStop = { at: number; color: string };

/** Linear interpolation between stops, clamped at both ends; no-data colour for null. */
export function colorFor(value: number | null, stops: readonly ColorStop[]): string {
  if (value === null || !Number.isFinite(value) || stops.length === 0) return NO_DATA_COLOR;
  const v = Math.max(stops[0].at, Math.min(stops[stops.length - 1].at, value));
  for (let k = 1; k < stops.length; k++) {
    if (v <= stops[k].at) {
      const a = stops[k - 1];
      const b = stops[k];
      const t = (v - a.at) / (b.at - a.at);
      const ca = hexToRgb(a.color);
      const cb = hexToRgb(b.color);
      return rgbToHex(ca.map((c, n) => c + (cb[n] - c) * t));
    }
  }
  return stops[stops.length - 1].color;
}

/** The TradingView palette stretched to ±cap (stops at thirds of the cap). */
export function divergingStops(cap: number): ColorStop[] {
  return CHANGE_COLOR_STOPS.map((stop) => ({ at: (stop.at / 3) * cap, color: stop.color }));
}

/**
 * Background for a day's % change: grey near zero, progressively red for
 * losses and green for gains, saturating at ±3% so one outlier can't wash
 * out the rest. Linear between the stops.
 */
export function changeColor(changePercent: number | null): string {
  return colorFor(changePercent, CHANGE_COLOR_STOPS);
}

/* ------------------------------------------------------------ format */

/**
 * "₹19.25L Cr" / "₹8,420 Cr" for INR (lakh crore is how Indian market caps are
 * quoted), "$3.45T" / "$812.3B" / "$950M" otherwise; "—" when unknown.
 */
export function formatMarketCap(value: number | null, currency: string | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "—";
  if (currency === "INR") {
    const crore = value / 1e7;
    if (crore >= 1e5) return `₹${(crore / 1e5).toFixed(2)}L Cr`;
    return `₹${Math.round(crore).toLocaleString("en-IN")} Cr`;
  }
  const symbol = currency === "USD" || currency === null ? "$" : `${currency} `;
  if (value >= 1e12) return `${symbol}${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `${symbol}${(value / 1e9).toFixed(1)}B`;
  return `${symbol}${Math.round(value / 1e6)}M`;
}
