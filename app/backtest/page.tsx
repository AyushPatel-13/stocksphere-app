"use client";

import { useState } from "react";

import { Sparkline } from "@/components/Markets/Sparkline";
import SearchBox from "@/components/Search/SearchBox";
import { PageHeader, PageShell, StatCard, inputClass, primaryButtonClass } from "@/components/ui/Page";
import { runBacktest, type BacktestResult, type Strategy } from "@/lib/analytics/backtest";
import { canonicalStockSymbol } from "@/lib/search/canonical";
import type { SearchResult } from "@/lib/search/instruments";

/**
 * Backtest a simple rule on one instrument's real price history. The rules
 * and their limits are stated on the page; results are history, not a
 * forecast.
 */

type Pick = { type: "stock" | "index" | "etf" | "crypto"; symbol: string; name: string };
type Period = "1y" | "3y" | "5y";

const PERIODS: { id: Period; label: string; note: string }[] = [
  { id: "1y", label: "1 year", note: "daily closes" },
  { id: "3y", label: "3 years", note: "weekly closes" },
  { id: "5y", label: "5 years", note: "weekly closes" },
];

const pct = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
const day = (t: number) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function BacktestPage() {
  const [pick, setPick] = useState<Pick | null>(null);
  const [period, setPeriod] = useState<Period>("1y");
  const [kind, setKind] = useState<Strategy["kind"]>("sma_cross");
  const [fast, setFast] = useState("20");
  const [slow, setSlow] = useState("50");
  const [single, setSingle] = useState("50");
  const [cost, setCost] = useState("0.1");
  const [state, setState] = useState<{ status: "idle" } | { status: "running" } | { status: "error"; message: string } | { status: "done"; result: BacktestResult; name: string }>({ status: "idle" });

  function choose(result: SearchResult) {
    const type = result.type === "stock" || result.type === "index" || result.type === "etf" || result.type === "crypto" ? result.type : null;
    if (!type) return;
    setPick({ type, symbol: type === "stock" || type === "etf" ? canonicalStockSymbol(result.symbol, result.market) : result.symbol.toUpperCase(), name: result.name });
  }

  async function run() {
    if (!pick) {
      setState({ status: "error", message: "Pick a stock, index, ETF or coin." });
      return;
    }
    setState({ status: "running" });
    try {
      const params = new URLSearchParams({ type: pick.type, symbol: pick.symbol, range: period });
      const data = await (await fetch(`/api/history?${params.toString()}`)).json();
      if (!data?.success) throw new Error("no history");

      const strategy: Strategy =
        kind === "buy_hold" ? { kind } : kind === "sma_cross" ? { kind, fast: Number(fast), slow: Number(slow) } : { kind, period: Number(single) };
      const result = runBacktest(
        (data.candles as { t: number; c: number }[]).map((c) => ({ t: c.t, c: c.c })),
        strategy,
        Number(cost)
      );
      setState("error" in result ? { status: "error", message: result.error } : { status: "done", result, name: pick.name });
    } catch {
      setState({ status: "error", message: "Price history couldn't be loaded right now." });
    }
  }

  return (
    <PageShell>
      <PageHeader eyebrow="Tools" title="Backtest a strategy" description="See how a simple rule would have done on real price history — with costs, and without hindsight." />

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run();
          }}
          className="space-y-3 rounded-2xl border border-[#222] bg-[#111] p-5"
        >
          <SearchBox variant="compact" inputId="backtest-search" placeholder="Search a stock, index or coin…" filterTypes={["stock", "etf", "index", "crypto"]} onSelect={choose} />
          {pick && (
            <p className="text-sm">
              <span className="font-semibold">{pick.symbol}</span> <span className="text-[#888]">{pick.name}</span>
            </p>
          )}

          <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={period === p.id}
                onClick={() => setPeriod(p.id)}
                className={`rounded-lg border py-1.5 text-xs ${period === p.id ? "border-[#22c55e]/60 bg-[#22c55e]/10 text-white" : "border-[#2a2a2a] text-[#aaa]"}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="mb-1 block text-xs text-[#888]">Rule</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as Strategy["kind"])} className={inputClass}>
              <option value="sma_cross">Moving-average crossover</option>
              <option value="above_sma">Price above a moving average</option>
              <option value="buy_hold">Buy and hold</option>
            </select>
          </label>

          {kind === "sma_cross" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs text-[#888]">Fast (bars)</span>
                <input value={fast} onChange={(e) => setFast(e.target.value)} inputMode="numeric" className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[#888]">Slow (bars)</span>
                <input value={slow} onChange={(e) => setSlow(e.target.value)} inputMode="numeric" className={inputClass} />
              </label>
            </div>
          )}
          {kind === "above_sma" && (
            <label className="block">
              <span className="mb-1 block text-xs text-[#888]">Average length (bars)</span>
              <input value={single} onChange={(e) => setSingle(e.target.value)} inputMode="numeric" className={inputClass} />
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-xs text-[#888]">Cost per buy or sell (%)</span>
            <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" className={inputClass} />
          </label>

          <button type="submit" disabled={state.status === "running"} className={`${primaryButtonClass} w-full`}>
            {state.status === "running" ? "Running…" : "Run backtest"}
          </button>

          <ul className="space-y-1 text-[11px] leading-relaxed text-[#777]">
            <li>• Signals use a bar&apos;s close and act at the next bar&apos;s close — no look-ahead.</li>
            <li>• Long only, all in or all out. No dividends, taxes or slippage beyond the cost.</li>
            <li>• {PERIODS.find((p) => p.id === period)?.label} uses {PERIODS.find((p) => p.id === period)?.note}, so “bars” are {period === "1y" ? "days" : "weeks"}.</li>
            <li>• Past results don&apos;t predict future ones. Not investment advice.</li>
          </ul>
        </form>

        <div className="min-w-0">
          {state.status === "idle" && (
            <div className="rounded-2xl border border-[#222] bg-[#111] px-6 py-16 text-center text-sm text-[#888]">Pick an instrument and a rule, then run the backtest.</div>
          )}
          {state.status === "running" && <div className="h-64 animate-pulse rounded-2xl bg-[#111]" />}
          {state.status === "error" && (
            <p role="alert" className="rounded-2xl border border-[#222] bg-[#111] px-6 py-10 text-center text-sm text-[#f87171]">
              {state.message}
            </p>
          )}
          {state.status === "done" && (
            <div className="space-y-4">
              <p className="text-sm text-[#aaa]">
                {state.name} · {day(state.result.startT)} – {day(state.result.endT)} · {state.result.bars} bars
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatCard label="Strategy return" value={pct(state.result.totalReturnPct)} tone={state.result.totalReturnPct >= 0 ? "up" : "down"} />
                <StatCard label="Buy & hold (no costs)" value={pct(state.result.buyHoldReturnPct)} tone={state.result.buyHoldReturnPct >= 0 ? "up" : "down"} />
                <StatCard label="Yearly (CAGR)" value={pct(state.result.cagrPct)} />
                <StatCard label="Max drawdown" value={`−${state.result.maxDrawdownPct.toFixed(2)}%`} tone="down" />
                <StatCard label="Trades / win rate" value={`${state.result.trades.length} / ${state.result.winRatePct === null ? "—" : `${state.result.winRatePct.toFixed(0)}%`}`} />
                <StatCard label="Time invested" value={`${state.result.exposurePct.toFixed(0)}%`} />
              </div>

              <div className="rounded-2xl border border-[#222] bg-[#111] p-5">
                <p className="mb-2 text-sm font-semibold">Equity curve (₹1 → {(1 + state.result.totalReturnPct / 100).toFixed(2)})</p>
                <Sparkline values={state.result.equity.map((e) => e.value)} up={state.result.totalReturnPct >= 0} width={640} height={120} />
              </div>

              {state.result.trades.length > 0 && (
                <div className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
                  <p className="border-b border-[#1d1d1d] px-5 py-3 text-sm font-semibold">Trades</p>
                  <table className="w-full text-sm">
                    <thead className="bg-[#0f0f0f] text-xs text-[#888]">
                      <tr>
                        <th scope="col" className="px-4 py-2 text-left font-medium">Entry</th>
                        <th scope="col" className="px-4 py-2 text-left font-medium">Exit</th>
                        <th scope="col" className="px-4 py-2 text-right font-medium">Return</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.result.trades.slice(-30).reverse().map((t) => (
                        <tr key={t.entryT} className="border-t border-[#1b1b1b]">
                          <td className="px-4 py-2 tabular-nums">{day(t.entryT)} @ {t.entryPrice.toFixed(2)}</td>
                          <td className="px-4 py-2 tabular-nums">{t.open ? "Still open" : `${day(t.exitT)} @ ${t.exitPrice.toFixed(2)}`}</td>
                          <td className={`px-4 py-2 text-right tabular-nums ${t.returnPct >= 0 ? "text-[#4ade80]" : "text-[#f87171]"}`}>{pct(t.returnPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
