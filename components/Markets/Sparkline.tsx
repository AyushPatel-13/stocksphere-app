/**
 * Small charts shared by market tables (index list, watchlist).
 * Presentation only: they draw the numbers they're given and draw nothing
 * when there aren't enough of them.
 */

export const SPARK_UP = "#00b386";
export const SPARK_DOWN = "#eb5b3c";

/**
 * A day's price line. The dashed line is the first point (the open of the
 * series), so the line reads above or below where the day started.
 */
export function Sparkline({
  values,
  up,
  width = 112,
  height = 32,
}: {
  values: number[];
  up: boolean;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <span className="inline-block" style={{ width, height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const points = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="inline-block">
      <line x1="0" x2={width} y1={y(values[0])} y2={y(values[0])} stroke="#333" strokeDasharray="2 3" />
      <polyline points={points} fill="none" stroke={up ? SPARK_UP : SPARK_DOWN} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Where a price sits between a low and a high (e.g. the 52-week range), as a
 * thin bar with a marker. Null when the range or price is missing.
 */
export function rangePosition(low: number | null, high: number | null, value: number | null): number | null {
  return low !== null && high !== null && value !== null && high > low
    ? Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100))
    : null;
}

export function MiniRange({ low, high, value }: { low: number | null; high: number | null; value: number | null }) {
  const position = rangePosition(low, high, value);
  if (position === null) return <span className="text-xs text-[#666]">—</span>;

  return (
    <span className="relative block h-3 w-full min-w-[80px]" aria-hidden="true">
      <span className="absolute inset-x-0 top-1 h-1 rounded-full bg-[#2a2a2a]" />
      <span className="absolute top-1 h-1 rounded-full bg-[#22c55e]/50" style={{ width: `${position}%` }} />
      <span className="absolute top-0 h-3 w-0.5 -translate-x-1/2 rounded bg-white" style={{ left: `${position}%` }} />
    </span>
  );
}
