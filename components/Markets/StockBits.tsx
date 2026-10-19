"use client";

import { useState } from "react";

import { logoUrl, type LogoMarket, type LogoType } from "@/lib/logos";

/**
 * Small pieces shared by the Markets pages (Explore, Holdings, Watchlist).
 */

const AVATAR_COLORS = ["#16a34a", "#2563eb", "#9333ea", "#ea580c", "#0891b2", "#db2777", "#ca8a04"];

/**
 * The instrument's logo on a light tile (most logos are drawn for white
 * backgrounds), served through /api/logo. Falls back to a coloured initial —
 * stable per symbol — when there is no logo or it fails to load.
 */
export function StockAvatar({
  symbol,
  size = 40,
  market,
  type = "stock",
}: {
  symbol: string;
  size?: number;
  /** Where the instrument trades; inferred from the symbol when omitted. */
  market?: LogoMarket;
  type?: LogoType;
}) {
  const src = logoUrl(symbol, market, type);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src && failedSrc !== src) {
    return (
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#2a2a2a] bg-white"
        style={{ width: size, height: size, padding: Math.round(size * 0.12) }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- small same-origin logo from /api/logo; next/image adds nothing here */}
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src)}
          className="h-full w-full object-contain"
        />
      </span>
    );
  }

  const color =
    AVATAR_COLORS[[...symbol].reduce((sum, c) => sum + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-xl font-bold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `${color}26`,
        border: `1px solid ${color}55`,
        color,
      }}
    >
      {symbol.charAt(0)}
    </span>
  );
}

/** "12.30%" — magnitude only; the colour carries the direction. */
export function absPercent(value: number | null) {
  return value === null || !Number.isFinite(value) ? "—" : `${Math.abs(value).toFixed(2)}%`;
}

/** "+12.30 (1.05%)" in green or red; "—" when the provider gave nothing. */
export function Change({
  change,
  percent,
}: {
  change: number | null;
  percent: number | null;
}) {
  if (change === null && percent === null) return <span className="text-[#666]">—</span>;

  const up = (change ?? percent ?? 0) >= 0;

  return (
    <span className={`tabular-nums ${up ? "text-[#4ade80]" : "text-[#f87171]"}`}>
      {change !== null && `${up ? "+" : ""}${change.toFixed(2)} `}
      {percent !== null && `(${absPercent(percent)})`}
    </span>
  );
}

/** Green for ≥ 0, red below, grey when unknown. */
export function toneClass(value: number | null) {
  if (value === null) return "text-[#888]";
  return value >= 0 ? "text-[#4ade80]" : "text-[#f87171]";
}
