"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { Candle } from "@/lib/apis/yahooChart";
import { ema, rsi, sma } from "@/lib/charts/indicators";
import { formatCompactVolume, formatValue } from "@/lib/charts/format";
import type { AssetType, ValueUnit } from "@/lib/data/assets";

/**
 * The price chart for every asset, in the style of a broker app:
 *
 *   - the real price path: 1-minute points for a day, drawn as straight
 *     segments (no smoothing, no fill, no grid, no axis clutter);
 *   - on 1D the time axis spans the whole trading session, so a live day's
 *     line stops where "now" is, with a dashed previous-close line;
 *   - hovering moves a crosshair and the header shows that moment's price
 *     and its change from the start of the range.
 *
 * Values keep the asset's own unit — ₹ for Indian assets, $ for US ones,
 * points for indices, % for yields — and nothing is converted. Candles,
 * moving averages, volume and RSI are optional tools underneath.
 */

const RANGES = [
  { id: "1d", label: "1D" },
  { id: "5d", label: "1W" },
  { id: "1mo", label: "1M" },
  { id: "3mo", label: "3M" },
  { id: "6mo", label: "6M" },
  { id: "1y", label: "1Y" },
  { id: "3y", label: "3Y" },
  { id: "5y", label: "5Y" },
  { id: "max", label: "All" },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

type HistoryResponse = {
  name: string | null;
  unit: ValueUnit;
  currency: string | null;
  range: RangeId;
  interval: string;
  candles: Candle[];
  previousClose: number | null;
  marketTime: string | null;
  sessionStart: number | null;
  sessionEnd: number | null;
  source: string;
};

type Overlay = "sma20" | "sma50" | "ema20";
type Panel = "volume" | "rsi";

const OVERLAYS: { id: Overlay; label: string; color: string }[] = [
  { id: "sma20", label: "SMA 20", color: "#f59e0b" },
  { id: "sma50", label: "SMA 50", color: "#a855f7" },
  { id: "ema20", label: "EMA 20", color: "#38bdf8" },
];

// The broker-app pair: a calm green and an orange-red that read well on black.
const UP = "#00b386";
const DOWN = "#eb5b3c";

type Row = Candle & {
  i: number;
  range: [number, number];
  sma20: number | null;
  sma50: number | null;
  ema20: number | null;
  rsi: number | null;
  up: boolean;
};

function toRows(candles: Candle[]): Row[] {
  const closes = candles.map((c) => c.c);
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const e20 = ema(closes, 20);
  const r14 = rsi(closes, 14);

  return candles.map((candle, i) => ({
    ...candle,
    i,
    range: [candle.l ?? candle.c, candle.h ?? candle.c],
    sma20: s20[i],
    sma50: s50[i],
    ema20: e20[i],
    rsi: r14[i],
    up: candle.c >= (candle.o ?? candle.c),
  }));
}

/** A candlestick drawn into the box recharts gives a [low, high] range bar. */
function CandleShape(props: { x?: number; y?: number; width?: number; height?: number; payload?: Row }) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  if (!payload) return null;

  const high = payload.h ?? payload.c;
  const low = payload.l ?? payload.c;
  const open = payload.o ?? payload.c;
  const scale = height / (high - low || 1);
  const yOpen = y + (high - open) * scale;
  const yClose = y + (high - payload.c) * scale;
  const color = payload.c >= open ? UP : DOWN;
  const bodyWidth = Math.max(1, width * 0.7);
  const center = x + width / 2;

  return (
    <g>
      <line x1={center} x2={center} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={center - bodyWidth / 2} y={Math.min(yOpen, yClose)} width={bodyWidth} height={Math.max(1, Math.abs(yClose - yOpen))} fill={color} />
    </g>
  );
}

/** The latest price: a solid dot with a soft pulse, like a live marker. */
function LiveDot(props: { cx?: number; cy?: number; fill?: string }) {
  const { cx, cy, fill } = props;
  if (cx === undefined || cy === undefined) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={8} fill={fill} opacity={0.18}>
        <animate attributeName="r" values="4;10;4" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.35;0;0.35" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx={cx} cy={cy} r={3.5} fill={fill} stroke="#000" strokeWidth={1.5} />
    </g>
  );
}

function timeLabel(t: number, range: RangeId, indian: boolean): string {
  const date = new Date(t);
  const timeZone = indian ? "Asia/Kolkata" : undefined;
  const time = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone });
  if (range === "1d") return time;
  if (range === "5d" || range === "1mo" || range === "3mo") {
    return `${date.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone })}, ${time}`;
  }
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone });
}

/** Price levels drawn on the chart, kept in this browser per instrument. */
const LEVELS_PREFIX = "stocksphere.levels.";
const MAX_LEVELS = 8;

function readLevels(key: string): number[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LEVELS_PREFIX + key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).slice(0, MAX_LEVELS) : [];
  } catch {
    return [];
  }
}

function writeLevels(key: string, levels: number[]) {
  try {
    window.localStorage.setItem(LEVELS_PREFIX + key, JSON.stringify(levels));
  } catch {
    /* not saved; the lines still show until reload */
  }
}

function Chip({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? "border-[#3a3a3a] bg-[#1c1c1c] text-white" : "border-[#262626] text-[#888] hover:text-white"
      }`}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: active ? color : "#444" }} />}
      {children}
    </button>
  );
}

export default function PriceChart({
  type,
  symbol,
  vs = "INR",
  initialRange = "1d",
  expiry,
}: {
  type: AssetType | "commodity";
  symbol: string;
  vs?: "INR" | "USD";
  initialRange?: RangeId;
  /** Commodity futures only: which contract (YYYY-MM-DD). */
  expiry?: string;
}) {
  const [range, setRange] = useState<RangeId>(initialRange);
  const [mode, setMode] = useState<"line" | "candles">("line");
  const [overlays, setOverlays] = useState<Set<Overlay>>(new Set());
  const [panels, setPanels] = useState<Set<Panel>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: HistoryResponse }
  >({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [drawing, setDrawing] = useState(false);
  const levelKey = `${type}:${symbol.toUpperCase()}`;

  useEffect(() => {
    const timer = window.setTimeout(() => setLevels(readLevels(levelKey)), 0);
    return () => window.clearTimeout(timer);
  }, [levelKey]);

  function updateLevels(next: number[]) {
    setLevels(next);
    writeLevels(levelKey, next);
  }

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ type, symbol, range, vs });
    if (expiry) params.set("expiry", expiry);

    fetch(`/api/history?${params.toString()}`)
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setState(
          data?.success
            ? { status: "ready", data: data as HistoryResponse }
            : { status: "error", message: data?.error ?? "Price history is unavailable." }
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "Couldn't load the chart." });
      });

    return () => {
      cancelled = true;
    };
  }, [type, symbol, range, vs, expiry, attempt]);

  const rows = useMemo(() => (state.status === "ready" ? toRows(state.data.candles) : []), [state]);
  const data = state.status === "ready" ? state.data : null;
  const unit = data?.unit ?? "currency";
  const currency = data?.currency ?? null;
  const indian = currency === "INR";
  const fmt = (value: number | null | undefined) => formatValue(value, unit, currency);
  const previousClose = data?.previousClose ?? null;
  const sessionStart = data?.sessionStart ?? null;
  const sessionEnd = data?.sessionEnd ?? null;

  // 1D uses real time on the x-axis, spanning the trading session; longer
  // ranges use the point index, so nights and weekends don't leave gaps.
  const timeAxis = range === "1d" && rows.length > 1;
  const xKey = timeAxis ? "t" : "i";
  const xDomain = useMemo<[number, number]>(() => {
    if (!timeAxis) return [0, Math.max(rows.length - 1, 1)];
    const first = rows[0].t;
    const last = rows[rows.length - 1].t;
    const sessionLength = sessionStart && sessionEnd ? sessionEnd - sessionStart : last - first;
    return [first, Math.max(last, first + sessionLength)];
  }, [timeAxis, rows, sessionStart, sessionEnd]);

  const showVolume = panels.has("volume") && rows.some((row) => (row.v ?? 0) > 0);
  const showRsi = panels.has("rsi");

  // A little headroom so the line never touches the edges.
  const yDomain = useMemo<[number, number]>(() => {
    const values: number[] = [];
    for (const row of rows) {
      values.push(mode === "candles" ? row.range[0] : row.c, mode === "candles" ? row.range[1] : row.c);
      for (const o of overlays) if (row[o] !== null) values.push(row[o] as number);
    }
    if (range === "1d" && previousClose !== null) values.push(previousClose);
    if (values.length === 0) return [0, 1];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min || Math.abs(max) * 0.01 || 1) * 0.08;
    return [min - pad, max + pad];
  }, [rows, mode, overlays, range, previousClose]);

  const last = rows[rows.length - 1];
  const focus = hover !== null && rows[hover] ? rows[hover] : last;
  const base = range === "1d" ? previousClose ?? rows[0]?.c : rows[0]?.c;
  const change = focus && base ? focus.c - base : null;
  const changePct = change !== null && base ? (change / base) * 100 : null;
  const up = (last && base ? last.c - base : 0) >= 0;
  const color = up ? UP : DOWN;
  const focusUp = (change ?? 0) >= 0;
  const chartId = `${type}-${symbol}`.replace(/[^a-z0-9-]/gi, "");
  const rangeLabel = RANGES.find((r) => r.id === range)?.label ?? "";

  function selectRange(next: RangeId) {
    if (next === range) return;
    setRange(next);
    setHover(null);
    setState({ status: "loading" });
  }

  function toggle<T>(set: Set<T>, value: T, update: (next: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  }

  const onMove = (chart: { activeTooltipIndex?: number | string | null }) => {
    const index = Number(chart?.activeTooltipIndex);
    setHover(Number.isFinite(index) ? index : null);
  };

  return (
    <section className="rounded-2xl border border-[#222] bg-[#0d0d0d] p-4 sm:p-5" aria-label="Price chart">
      {/* Price for the hovered moment (or the latest) and its change over the range */}
      <div className="min-h-[60px]">
        {state.status === "ready" && focus ? (
          <>
            <p className="text-[28px] font-semibold tabular-nums leading-tight tracking-tight">{fmt(focus.c)}</p>
            <p className="mt-0.5 text-sm font-medium tabular-nums" style={{ color: focusUp ? UP : DOWN }}>
              {change !== null &&
                `${focusUp ? "+" : "-"}${unit === "percent" ? `${Math.abs(change).toFixed(3)} pts` : fmt(Math.abs(change)).replace("-", "")}`}
              {changePct !== null && ` (${Math.abs(changePct).toFixed(2)}%)`}
              <span className="ml-1.5 font-normal text-[#777]">
                {hover !== null && rows[hover] ? timeLabel(rows[hover].t, range, indian) : rangeLabel}
              </span>
            </p>
          </>
        ) : (
          <div className="space-y-2">
            <div className="h-8 w-40 animate-pulse rounded bg-[#1a1a1a]" />
            <div className="h-4 w-28 animate-pulse rounded bg-[#181818]" />
          </div>
        )}
      </div>

      <div className="mt-3">
        {state.status === "loading" && <div className="h-[320px] animate-pulse rounded-xl bg-[#121212]" />}

        {state.status === "error" && (
          <div className="flex h-[320px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[#2a2a2a] text-center">
            <p className="text-sm text-[#888]">{state.message}</p>
            <button
              type="button"
              onClick={() => {
                setState({ status: "loading" });
                setAttempt((n) => n + 1);
              }}
              className="rounded-lg border border-[#2a2a2a] px-3 py-1.5 text-xs font-semibold hover:bg-[#1a1a1a]"
            >
              Try again
            </button>
          </div>
        )}

        {state.status === "ready" && (
          <div onMouseLeave={() => setHover(null)}>
            <div className={`h-[320px] ${drawing ? "cursor-copy" : "cursor-crosshair"}`}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={rows}
                  syncId={chartId}
                  margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
                  onMouseMove={onMove}
                  onClick={() => {
                    if (!drawing || hover === null || !rows[hover]) return;
                    const price = Math.round(rows[hover].c * 100) / 100;
                    if (!levels.includes(price)) updateLevels([...levels, price].slice(-MAX_LEVELS));
                    setDrawing(false);
                  }}
                >
                  <XAxis dataKey={xKey} type="number" domain={xDomain} hide allowDataOverflow />
                  <YAxis domain={yDomain} hide allowDataOverflow />
                  <Tooltip
                    cursor={{ stroke: "#666", strokeWidth: 1 }}
                    isAnimationActive={false}
                    content={({ active, payload }) => {
                      const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
                      if (!row) return null;
                      return (
                        <div className="rounded-md bg-[#1f1f1f] px-2 py-1 text-[11px] tabular-nums text-[#ddd] shadow">
                          {mode === "candles" && row.o !== null ? (
                            <>O {fmt(row.o)} · H {fmt(row.h)} · L {fmt(row.l)} · C {fmt(row.c)}</>
                          ) : (
                            timeLabel(row.t, range, indian)
                          )}
                          {row.v ? <span className="text-[#888]"> · Vol {formatCompactVolume(row.v, indian)}</span> : null}
                        </div>
                      );
                    }}
                  />
                  {range === "1d" && previousClose !== null && (
                    <ReferenceLine y={previousClose} stroke="#4a4a4a" strokeDasharray="3 4" />
                  )}
                  {levels.map((level) => (
                    <ReferenceLine
                      key={level}
                      y={level}
                      stroke="#eab308"
                      strokeDasharray="6 4"
                      label={{ value: fmt(level), position: "insideTopRight", fill: "#eab308", fontSize: 10 }}
                    />
                  ))}
                  {mode === "line" ? (
                    <Line
                      type="linear"
                      dataKey="c"
                      stroke={color}
                      strokeWidth={1.6}
                      dot={false}
                      activeDot={{ r: 4, fill: color, stroke: "#000", strokeWidth: 1.5 }}
                      isAnimationActive={false}
                    />
                  ) : (
                    <Bar dataKey="range" shape={<CandleShape />} isAnimationActive={false} />
                  )}
                  {OVERLAYS.filter((o) => overlays.has(o.id)).map((o) => (
                    <Line key={o.id} type="linear" dataKey={o.id} stroke={o.color} strokeWidth={1.25} dot={false} isAnimationActive={false} />
                  ))}
                  {mode === "line" && last && hover === null && (
                    <ReferenceDot x={last[xKey]} y={last.c} shape={<LiveDot fill={color} />} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {showVolume && (
              <div className="h-[56px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows} syncId={chartId} margin={{ top: 0, right: 8, bottom: 0, left: 8 }} onMouseMove={onMove}>
                    <XAxis dataKey={xKey} type="number" domain={xDomain} hide allowDataOverflow />
                    <YAxis hide />
                    <Tooltip content={() => null} cursor={{ fill: "#ffffff0d" }} />
                    <Bar dataKey="v" isAnimationActive={false}>
                      {rows.map((row) => (
                        <Cell key={row.i} fill={row.up ? `${UP}66` : `${DOWN}66`} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {showRsi && (
              <div className="mt-1 h-[72px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} syncId={chartId} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} onMouseMove={onMove}>
                    <XAxis dataKey={xKey} type="number" domain={xDomain} hide allowDataOverflow />
                    <YAxis hide domain={[0, 100]} />
                    <ReferenceLine y={70} stroke={`${DOWN}66`} strokeDasharray="3 3" />
                    <ReferenceLine y={30} stroke={`${UP}66`} strokeDasharray="3 3" />
                    <Tooltip content={() => null} cursor={{ stroke: "#666" }} />
                    <Line type="linear" dataKey="rsi" stroke="#d4d4d4" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
                <p className="-mt-3 text-right text-[10px] text-[#666]">RSI 14 · 70 / 30</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Ranges, and the candlestick toggle at the end */}
      <div className="mt-3 flex items-center gap-1.5 overflow-x-auto border-t border-[#1d1d1d] pt-3 [scrollbar-width:none]" role="group" aria-label="Range">
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            aria-pressed={range === r.id}
            onClick={() => selectRange(r.id)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              range === r.id ? "border-[#3a3a3a] bg-[#1f1f1f] text-white" : "border-[#262626] text-[#999] hover:text-white"
            }`}
          >
            {r.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={mode === "candles"}
          aria-label={mode === "candles" ? "Show line chart" : "Show candlesticks"}
          title={mode === "candles" ? "Line chart" : "Candlesticks"}
          onClick={() => setMode(mode === "candles" ? "line" : "candles")}
          className={`ml-auto flex h-8 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${
            mode === "candles" ? "border-[#3a3a3a] bg-[#1f1f1f]" : "border-[#262626] hover:bg-[#161616]"
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <line x1="4" y1="2" x2="4" y2="14" stroke={DOWN} strokeWidth="1.2" />
            <rect x="2.5" y="5" width="3" height="6" fill={DOWN} />
            <line x1="11" y1="1" x2="11" y2="13" stroke={UP} strokeWidth="1.2" />
            <rect x="9.5" y="3" width="3" height="7" fill={UP} />
          </svg>
        </button>
      </div>

      {/* Tools */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] uppercase tracking-wide text-[#666]">Tools</span>
        {OVERLAYS.map((o) => (
          <Chip key={o.id} active={overlays.has(o.id)} color={o.color} onClick={() => toggle(overlays, o.id, setOverlays)}>
            {o.label}
          </Chip>
        ))}
        <Chip active={panels.has("volume")} onClick={() => toggle(panels, "volume", setPanels)}>
          Volume
        </Chip>
        <Chip active={panels.has("rsi")} onClick={() => toggle(panels, "rsi", setPanels)}>
          RSI 14
        </Chip>
        <Chip active={drawing} color="#eab308" onClick={() => setDrawing((value) => !value)}>
          {drawing ? "Click the chart to place a level" : "+ Price level"}
        </Chip>
      </div>

      {levels.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-[11px] text-[#666]">Levels (this browser):</span>
          {levels.map((level) => (
            <span key={level} className="flex items-center gap-1 rounded-full border border-[#eab308]/40 px-2 py-0.5 tabular-nums text-[#facc15]">
              {fmt(level)}
              <button type="button" onClick={() => updateLevels(levels.filter((l) => l !== level))} aria-label={`Remove level ${fmt(level)}`} className="text-[#888] hover:text-white">
                ✕
              </button>
            </span>
          ))}
          <button type="button" onClick={() => updateLevels([])} className="text-[11px] text-[#888] hover:text-white">
            Clear
          </button>
        </div>
      )}

      {data && (
        <p className="mt-3 text-[11px] text-[#666]">
          {unit === "currency" && currency ? `Prices in ${currency === "INR" ? "Indian rupees (₹)" : currency === "USD" ? "US dollars ($)" : currency}` : unit === "percent" ? "Yield in percent" : "Index points"}
          {" · "}Source: {data.source}
          {data.marketTime && ` · as of ${new Date(data.marketTime).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
        </p>
      )}
    </section>
  );
}
