"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { MiniRange } from "@/components/Markets/Sparkline";
import { StockAvatar, signedPercent, toneClass } from "@/components/Markets/StockBits";
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
  deriveFundamentals,
  formatCap,
  normaliseCriteria,
} from "@/lib/analytics/screener";
import { formatMoney, formatVolume } from "@/lib/client/useQuotes";
import { NIFTY_50_SYMBOLS } from "@/lib/data/instruments/india";
import type { WatchlistRow } from "@/lib/services/watchlistRows";
import type { ScreenerFundamentals } from "@/lib/services/screenerFundamentals";
import { accountScreens } from "@/lib/screener/accountScreens";
import { loadScreens, removeScreen, saveScreen, type SavedScreens } from "@/lib/screener/savedScreens";
import { supabase } from "@/lib/supabase";
import { addToWatchlist, getWatchlist } from "@/lib/watchlist";

type WatchState = { status: "loading" } | { status: "signed-out" } | { status: "ready"; symbols: Set<string>; pending: Set<string>; failed: Set<string> };

/** "+ Watch" on a result row: adds it to the member's watchlist once the database confirms. */
function WatchCell({ symbol, state, onAdd }: { symbol: string; state: WatchState; onAdd: (symbol: string) => void }) {
  const base = "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/40";
  if (state.status === "loading") return <span className="text-xs text-[#555]">…</span>;
  if (state.status === "signed-out") {
    return (
      <Link href="/login" className={`${base} border-[#2a2a2a] text-[#aaa] hover:text-white`} aria-label={`Sign in to add ${symbol} to your watchlist`}>
        + Watch
      </Link>
    );
  }
  if (state.symbols.has(symbol)) return <span className="text-xs text-[#4ade80]">✓ Watching</span>;
  const pending = state.pending.has(symbol);
  return (
    <button
      type="button"
      onClick={() => onAdd(symbol)}
      disabled={pending}
      aria-label={`Add ${symbol} to your watchlist`}
      className={`${base} ${state.failed.has(symbol) ? "border-red-500/40 text-red-300" : "border-[#2a2a2a] text-[#ddd] hover:border-[#22c55e]/60 hover:text-[#4ade80]"} disabled:opacity-50`}
    >
      {pending ? "Adding…" : state.failed.has(symbol) ? "Retry" : "+ Watch"}
    </button>
  );
}

/**
 * Screener over the NIFTY 50 and 20 US large caps: day change, 52-week
 * position and volume, with presets, custom filters and the reason each stock
 * matched. Data is from /api/watchlist/rows (Yahoo, may be delayed).
 */

type Universe = { status: "loading" } | { status: "error" } | { status: "ready"; rows: (WatchlistRow & { market: "india" | "us" })[] };

const ROWS_PER_REQUEST = 50;
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
  // With the member's account when signed in (so they follow them), in this browser otherwise.
  const [saved, setSaved] = useState<SavedScreens>({ where: "device", screens: [] });
  const [saveNote, setSaveNote] = useState<string | null>(null);
  // Shares, EPS and sector for the universe. "off" when they couldn't be loaded: the price filters still work.
  const [fundamentals, setFundamentals] = useState<{ status: "loading" } | { status: "off" } | { status: "ready"; data: ScreenerFundamentals }>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/screener/fundamentals")
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setFundamentals(data?.success ? { status: "ready", data } : { status: "off" });
      })
      .catch(() => {
        if (!cancelled) setFundamentals({ status: "off" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadUniverse()
      .then((rows) => {
        if (!cancelled) setUniverse({ status: "ready", rows });
      })
      .catch(() => {
        if (!cancelled) setUniverse({ status: "error" });
      });
    loadScreens(accountScreens, window.localStorage).then((result) => {
      if (!cancelled) setSaved(result);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const [watch, setWatch] = useState<WatchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        if (!cancelled) setWatch({ status: "signed-out" });
        return;
      }
      try {
        const rows = await getWatchlist();
        if (!cancelled) setWatch({ status: "ready", symbols: new Set(rows.map((r) => String(r.symbol).toUpperCase())), pending: new Set(), failed: new Set() });
      } catch {
        // Unknown membership: let them try; the database rejects nothing harmful.
        if (!cancelled) setWatch({ status: "ready", symbols: new Set(), pending: new Set(), failed: new Set() });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function addWatch(symbol: string) {
    const edit = (fn: (s: Extract<WatchState, { status: "ready" }>) => Partial<Extract<WatchState, { status: "ready" }>>) =>
      setWatch((current) => (current.status === "ready" ? { ...current, ...fn(current) } : current));
    edit((s) => ({ pending: new Set(s.pending).add(symbol), failed: new Set([...s.failed].filter((x) => x !== symbol)) }));
    const result = await addToWatchlist(symbol);
    if (!result) return setWatch({ status: "signed-out" });
    edit((s) => {
      const pending = new Set(s.pending);
      pending.delete(symbol);
      return result.error ? { pending, failed: new Set(s.failed).add(symbol) } : { pending, symbols: new Set(s.symbols).add(symbol) };
    });
  }

  const results = useMemo(() => {
    if (universe.status !== "ready") return [];
    const bySymbol = fundamentals.status === "ready" ? fundamentals.data.bySymbol : {};
    const rows = universe.rows.map((row) => ({ ...row, ...deriveFundamentals(row.price, bySymbol[row.symbol.toUpperCase()]) }));
    return sortScreen(applyScreen(rows, criteria, preset === "big_movers"), sort.key, sort.desc);
  }, [universe, fundamentals, criteria, preset, sort]);
  const usesFundamentals = criteria.minPe !== null || criteria.maxPe !== null || criteria.minMarketCapCr !== null || criteria.minMarketCapUsdBn !== null || criteria.sector !== null;

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

  async function saveCurrent() {
    const name = window.prompt("Name this screen", "My screen");
    if (name === null) return;
    const result = await saveScreen(name, criteria, accountScreens, window.localStorage);
    if (result.ok) {
      setSaved(result.saved);
      setSaveNote(result.saved.where === "account" ? "Saved to your account." : "Saved on this device.");
    } else {
      setSaveNote(result.reason === "full" ? "You can keep up to 10 saved screens. Remove one first." : "Give the screen a name to save it.");
    }
  }

  async function removeSaved(name: string) {
    setSaved(await removeScreen(name, accountScreens, window.localStorage));
    setSaveNote(null);
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
        description="Filter the NIFTY 50 and 20 US large caps by today's move, 52-week position, volume, P/E, market cap and sector. Every result shows why it matched."
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
            {saved.screens.length > 0 && (
              <>
                <p className="mb-2 mt-4 text-xs text-[#888]">{saved.where === "account" ? "Saved to your account" : "Saved on this device"}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {saved.screens.map((s) => (
                    <li key={s.name} className="inline-flex items-center rounded-full border border-[#2a2a2a] text-xs text-[#ccc]">
                      <button
                        type="button"
                        onClick={() => {
                          setPreset("custom");
                          setCriteria(normaliseCriteria(s.criteria));
                        }}
                        className="rounded-l-full py-1 pl-3 pr-1.5 hover:text-white"
                      >
                        {s.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSaved(s.name)}
                        aria-label={`Remove saved screen ${s.name}`}
                        className="rounded-r-full py-1 pl-1 pr-2.5 text-[#777] hover:text-red-300"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {saveNote && (
              <p className="mt-3 text-xs text-[#999]" role="status">
                {saveNote}
              </p>
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

            <p className="border-t border-[#1d1d1d] pt-3 text-sm font-semibold">Fundamentals</p>
            {fundamentals.status === "off" ? (
              <p className="text-xs text-[#888]">Fundamentals couldn&apos;t be loaded right now, so these filters are off. The filters above still work.</p>
            ) : (
              <fieldset disabled={fundamentals.status !== "ready"} className="space-y-3 disabled:opacity-50">
                <legend className="sr-only">Fundamental filters</legend>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="P/E ≥" value={criteria.minPe} onChange={(v) => update({ minPe: v })} />
                  <NumberField label="P/E ≤" value={criteria.maxPe} onChange={(v) => update({ maxPe: v })} />
                </div>
                <NumberField label="Market cap at least (India)" value={criteria.minMarketCapCr} onChange={(v) => update({ minMarketCapCr: v })} suffix="₹ Cr" />
                <NumberField label="Market cap at least (US)" value={criteria.minMarketCapUsdBn} onChange={(v) => update({ minMarketCapUsdBn: v })} suffix="$ B" />
                <label className="block">
                  <span className="mb-1 block text-xs text-[#888]">Sector (NIFTY 50)</span>
                  <select
                    value={criteria.sector ?? ""}
                    onChange={(e) => update({ sector: e.target.value || null })}
                    className="w-full rounded-lg border border-[#2a2a2a] bg-black px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#22c55e]/60"
                  >
                    <option value="">Any sector</option>
                    {(fundamentals.status === "ready" ? fundamentals.data.sectors : []).map((sector) => (
                      <option key={sector} value={sector}>
                        {sector}
                      </option>
                    ))}
                  </select>
                </label>
                {fundamentals.status === "loading" && <p className="text-xs text-[#888]">Loading fundamentals…</p>}
              </fieldset>
            )}
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
              <div className="overflow-x-auto rounded-2xl border border-[#222] bg-[#111]">
                {results.length === 0 ? (
                  <p className="px-6 py-12 text-center text-sm text-[#888]">No stocks match these filters right now.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="border-b border-[#1d1d1d] bg-[#0f0f0f] text-xs text-[#888]">
                      <tr>
                        {header("Company", "symbol", "pl-4 text-left")}
                        {header("Price", "price", "text-right")}
                        {header("1D change", "change", "text-right")}
                        {header("Market cap", "marketCap", "hidden text-right lg:table-cell")}
                        {header("P/E", "pe", "hidden text-right lg:table-cell")}
                        {header("Volume", "volume", "hidden text-right md:table-cell")}
                        {header("52W position", "position", "hidden text-left xl:table-cell")}
                        <th className="py-3 pl-2 pr-4 text-right font-medium">
                          <span className="sr-only">Watchlist</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((row) => (
                        <tr key={row.symbol} className="group border-b border-[#1b1b1b] last:border-b-0 hover:bg-[#151515]">
                          <td className="py-3 pl-4 pr-3">
                            <Link href={`/stock/${encodeURIComponent(row.symbol)}`} className="flex items-center gap-3">
                              <StockAvatar symbol={row.symbol} size={32} />
                              <span className="min-w-0 max-w-[11rem] sm:max-w-[16rem]">
                                <span className="block truncate font-semibold group-hover:text-[#22c55e]">{row.symbol}</span>
                                <span className="block truncate text-xs text-[#777]">
                                  {row.reasons.length > 0 ? `Matched: ${row.reasons.join(" · ")}` : [row.name, row.sector].filter(Boolean).join(" · ")}
                                </span>
                              </span>
                            </Link>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">{formatMoney(row.price!, row.currency ?? (row.market === "us" ? "USD" : "INR"))}</td>
                          <td className={`px-3 py-3 text-right font-medium tabular-nums ${toneClass(row.changePercent)}`}>{signedPercent(row.changePercent)}</td>
                          <td className="hidden whitespace-nowrap px-3 py-3 text-right tabular-nums text-[#ccc] lg:table-cell">
                            {row.marketCap ? formatCap(row.marketCap, row.market === "us" ? "USD" : "INR") : "—"}
                          </td>
                          <td className="hidden px-3 py-3 text-right tabular-nums text-[#ccc] lg:table-cell">{row.pe ? row.pe.toFixed(1) : "—"}</td>
                          <td className="hidden px-3 py-3 text-right tabular-nums text-[#ccc] md:table-cell">{formatVolume(row.volume, row.currency ?? undefined)}</td>
                          <td className="hidden w-40 px-3 py-3 xl:table-cell">
                            <MiniRange low={row.fiftyTwoWeekLow} high={row.fiftyTwoWeekHigh} value={row.price} />
                          </td>
                          <td className="py-3 pl-2 pr-4 text-right">
                            <WatchCell symbol={row.symbol.toUpperCase()} state={watch} onAdd={addWatch} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <p className="mt-3 text-[11px] text-[#666]">
                Prices from Yahoo Finance; may be delayed. Market cap is price × shares outstanding and P/E is market cap ÷ the last fiscal year&apos;s net income (Yahoo Finance); a company with a loss has no P/E.
                {fundamentals.status === "ready" && fundamentals.data.sectorSource ? ` Sector: ${fundamentals.data.sectorSource}; US stocks have none here.` : ""}
                {usesFundamentals ? " A stock whose figure couldn't be sourced doesn't match a filter on it." : ""} Screens describe today&apos;s data — they aren&apos;t recommendations.
              </p>
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
