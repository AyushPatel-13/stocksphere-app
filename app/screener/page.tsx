"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { MiniRange } from "@/components/Markets/Sparkline";
import { StockAvatar, absPercent, toneClass } from "@/components/Markets/StockBits";
import { PageHeader, PageShell, secondaryButtonClass } from "@/components/ui/Page";
import {
  EMPTY_CRITERIA,
  PRESETS,
  US_LARGE_CAPS,
  applyScreen,
  sortScreen,
  type PresetId,
  type ScreenCriteria,
  type ScreenSortKey,
} from "@/lib/analytics/screener";
import { formatMoney, formatVolume } from "@/lib/client/useQuotes";
import { NIFTY_50_SYMBOLS } from "@/lib/data/instruments/india";
import type { WatchlistRow } from "@/lib/services/watchlistRows";

/**
 * Screener over the NIFTY 50 and 20 US large caps: day change, 52-week
 * position and volume, with presets, custom filters and the reason each stock
 * matched. Data is from /api/watchlist/rows (Yahoo, may be delayed).
 */

type Universe = { status: "loading" } | { status: "error" } | { status: "ready"; rows: (WatchlistRow & { market: "india" | "us" })[] };

const ROWS_PER_REQUEST = 50;
const SAVED_KEY = "stocksphere.screener.saved";

type SavedScreen = { name: string; criteria: ScreenCriteria };

function readSaved(): SavedScreen[] {
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
  } catch {
    return [];
  }
}

function writeSaved(screens: SavedScreen[]) {
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(screens.slice(0, 10)));
  } catch {
    /* storage unavailable: saved screens just don't persist */
  }
}

async function loadUniverse(): Promise<(WatchlistRow & { market: "india" | "us" })[]> {
  // /api/watchlist/rows takes at most 50 symbols per request.
  const fetchRows = async (symbols: string[], market: "india" | "us") => {
    const chunks: string[][] = [];
    for (let i = 0; i < symbols.length; i += ROWS_PER_REQUEST) chunks.push(symbols.slice(i, i + ROWS_PER_REQUEST));
    const parts = await Promise.all(
      chunks.map(async (chunk) => {
        const data = await (await fetch(`/api/watchlist/rows?symbols=${encodeURIComponent(chunk.join(","))}`)).json();
        if (!data?.success) throw new Error("rows failed");
        return (data.rows as WatchlistRow[]).map((row) => ({ ...row, market }));
      })
    );
    return parts.flat();
  };
  const [india, us] = await Promise.all([fetchRows([...NIFTY_50_SYMBOLS], "india"), fetchRows(US_LARGE_CAPS, "us")]);
  return [...india, ...us];
}

function NumberField({ label, value, onChange, suffix }: { label: string; value: number | null; onChange: (v: number | null) => void; suffix?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[#888]">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          inputMode="decimal"
          value={value ?? ""}
          onChange={(e) => {
            const raw = e.target.value.trim();
            const n = Number(raw);
            onChange(raw === "" || !Number.isFinite(n) ? null : n);
          }}
          className="w-full rounded-lg border border-[#2a2a2a] bg-black px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#22c55e]/60"
        />
        {suffix && <span className="text-xs text-[#777]">{suffix}</span>}
      </span>
    </label>
  );
}

export default function ScreenerPage() {
  const [universe, setUniverse] = useState<Universe>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [preset, setPreset] = useState<PresetId | "custom">("all");
  const [criteria, setCriteria] = useState<ScreenCriteria>(EMPTY_CRITERIA);
  const [sort, setSort] = useState<{ key: ScreenSortKey; desc: boolean }>({ key: "change", desc: true });
  const [saved, setSaved] = useState<SavedScreen[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadUniverse()
      .then((rows) => {
        if (!cancelled) setUniverse({ status: "ready", rows });
      })
      .catch(() => {
        if (!cancelled) setUniverse({ status: "error" });
      });
    // Saved screens live in this browser only (a per-device convenience).
    const timer = window.setTimeout(() => setSaved(readSaved()), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [attempt]);

  const results = useMemo(() => {
    if (universe.status !== "ready") return [];
    return sortScreen(applyScreen(universe.rows, criteria, preset === "big_movers"), sort.key, sort.desc);
  }, [universe, criteria, preset, sort]);

  function choosePreset(id: PresetId) {
    const p = PRESETS.find((entry) => entry.id === id)!;
    setPreset(id);
    setCriteria({ ...EMPTY_CRITERIA, market: criteria.market, ...p.criteria });
    setSort(p.sort);
  }

  function update(patch: Partial<ScreenCriteria>) {
    setPreset("custom");
    setCriteria((current) => ({ ...current, ...patch }));
  }

  function saveCurrent() {
    const name = window.prompt("Name this screen", "My screen")?.trim();
    if (!name) return;
    const next = [{ name: name.slice(0, 40), criteria }, ...saved.filter((s) => s.name !== name)].slice(0, 10);
    setSaved(next);
    writeSaved(next);
  }

  function sortBy(key: ScreenSortKey) {
    setSort((current) => (current.key === key ? { key, desc: !current.desc } : { key, desc: key !== "symbol" }));
  }

  const header = (label: string, key: ScreenSortKey, className = "") => (
    <th scope="col" aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"} className={`px-3 py-3 font-medium ${className}`}>
      <button type="button" onClick={() => sortBy(key)} className={`inline-flex items-center gap-1 hover:text-white ${sort.key === key ? "text-white" : ""}`}>
        {label}
        <span aria-hidden="true" className="text-[9px]">
          {sort.key === key ? (sort.desc ? "▼" : "▲") : "⇅"}
        </span>
      </button>
    </th>
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Screener"
        title="Stock screener"
        description="Filter the NIFTY 50 and 20 US large caps by today's move, 52-week position and volume. Every result shows why it matched."
      />

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="rounded-2xl border border-[#222] bg-[#111] p-4">
            <p className="mb-2 text-sm font-semibold">Screens</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={preset === p.id}
                  onClick={() => choosePreset(p.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${preset === p.id ? "border-[#22c55e]/60 bg-[#22c55e]/10 text-white" : "border-[#2a2a2a] text-[#aaa] hover:text-white"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {saved.length > 0 && (
              <>
                <p className="mb-2 mt-4 text-xs text-[#888]">Saved on this device</p>
                <div className="flex flex-wrap gap-1.5">
                  {saved.map((s) => (
                    <button
                      key={s.name}
                      type="button"
                      onClick={() => {
                        setPreset("custom");
                        setCriteria(s.criteria);
                      }}
                      className="rounded-full border border-[#2a2a2a] px-3 py-1 text-xs text-[#ccc] hover:text-white"
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="space-y-3 rounded-2xl border border-[#222] bg-[#111] p-4">
            <p className="text-sm font-semibold">Filters</p>
            <div className="flex gap-1.5" role="group" aria-label="Market">
              {(["all", "india", "us"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={criteria.market === m}
                  onClick={() => setCriteria((c) => ({ ...c, market: m }))}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium ${criteria.market === m ? "border-[#22c55e]/60 bg-[#22c55e]/10 text-white" : "border-[#2a2a2a] text-[#aaa]"}`}
                >
                  {m === "all" ? "All" : m === "india" ? "India" : "US"}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Day change ≥" value={criteria.minChangePct} onChange={(v) => update({ minChangePct: v })} suffix="%" />
              <NumberField label="Day change ≤" value={criteria.maxChangePct} onChange={(v) => update({ maxChangePct: v })} suffix="%" />
            </div>
            <NumberField label="Within … of 52W high" value={criteria.withinOfHighPct} onChange={(v) => update({ withinOfHighPct: v })} suffix="%" />
            <NumberField label="Within … of 52W low" value={criteria.withinOfLowPct} onChange={(v) => update({ withinOfLowPct: v })} suffix="%" />
            <NumberField label="Volume at least" value={criteria.minVolume} onChange={(v) => update({ minVolume: v })} />
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => choosePreset("all")} className="flex-1 rounded-lg px-2 py-1.5 text-xs text-[#aaa] hover:bg-[#1a1a1a]">
                Reset
              </button>
              <button type="button" onClick={saveCurrent} className="flex-1 rounded-lg border border-[#2a2a2a] px-2 py-1.5 text-xs text-[#4ade80] hover:bg-[#22c55e]/10">
                Save screen
              </button>
            </div>
          </section>
        </aside>

        <div className="min-w-0">
          {universe.status === "loading" && (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-[#111]" />
              ))}
              <p className="text-center text-xs text-[#666]">Loading {NIFTY_50_SYMBOLS.length + US_LARGE_CAPS.length} stocks…</p>
            </div>
          )}
          {universe.status === "error" && (
            <div className="rounded-2xl border border-[#222] bg-[#111] px-6 py-10 text-center">
              <p className="text-sm text-[#888]">Screener data couldn&apos;t be loaded right now.</p>
              <button
                type="button"
                onClick={() => {
                  setUniverse({ status: "loading" });
                  setAttempt((n) => n + 1);
                }}
                className={`${secondaryButtonClass} mt-3`}
              >
                Try again
              </button>
            </div>
          )}
          {universe.status === "ready" && (
            <>
              <p className="mb-2 text-sm text-[#888]">
                {results.length} of {universe.rows.filter((r) => r.price !== null).length} stocks match
              </p>
              <div className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
                {results.length === 0 ? (
                  <p className="px-6 py-12 text-center text-sm text-[#888]">No stocks match these filters right now.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="border-b border-[#1d1d1d] bg-[#0f0f0f] text-xs text-[#888]">
                      <tr>
                        {header("Company", "symbol", "pl-4 text-left")}
                        {header("Price", "price", "text-right")}
                        {header("1D change", "change", "text-right")}
                        {header("Volume", "volume", "hidden text-right md:table-cell")}
                        {header("52W position", "position", "hidden text-left lg:table-cell")}
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((row) => (
                        <tr key={row.symbol} className="group border-b border-[#1b1b1b] last:border-b-0 hover:bg-[#151515]">
                          <td className="py-3 pl-4 pr-3">
                            <Link href={`/stock/${encodeURIComponent(row.symbol)}`} className="flex items-center gap-3">
                              <StockAvatar symbol={row.symbol} size={32} />
                              <span className="min-w-0">
                                <span className="block truncate font-semibold group-hover:text-[#22c55e]">{row.symbol}</span>
                                <span className="block truncate text-xs text-[#777]">
                                  {row.reasons.length > 0 ? `Matched: ${row.reasons.join(" · ")}` : row.name ?? ""}
                                </span>
                              </span>
                            </Link>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">{formatMoney(row.price!, row.currency ?? (row.market === "us" ? "USD" : "INR"))}</td>
                          <td className={`px-3 py-3 text-right font-medium tabular-nums ${toneClass(row.changePercent)}`}>{absPercent(row.changePercent)}</td>
                          <td className="hidden px-3 py-3 text-right tabular-nums text-[#ccc] md:table-cell">{formatVolume(row.volume, row.currency ?? undefined)}</td>
                          <td className="hidden w-40 px-3 py-3 lg:table-cell">
                            <MiniRange low={row.fiftyTwoWeekLow} high={row.fiftyTwoWeekHigh} value={row.price} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <p className="mt-3 text-[11px] text-[#666]">
                Prices from Yahoo Finance; may be delayed. Screens describe today&apos;s data — they aren&apos;t recommendations.
              </p>
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
