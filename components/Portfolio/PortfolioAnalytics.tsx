"use client";

import { toneClass } from "@/components/Markets/StockBits";
import { analysePortfolio } from "@/lib/analytics/portfolio";
import type { HoldingView } from "@/lib/client/holdings";
import { formatMoney } from "@/lib/client/useQuotes";

/** Holdings as CSV, with the live values used on screen (blank when unpriced). */
export function holdingsCsv(views: HoldingView[]): string {
  const cell = (value: string | number | null) => {
    const text = value === null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = ["symbol", "quantity", "avg_price", "invested", "currency", "current_value", "pnl", "pnl_pct"];
  const lines = views.map((v) =>
    [v.symbol, v.quantity, v.avgPrice, Math.round(v.invested * 100) / 100, v.quote?.currency ?? null, v.current === null ? null : Math.round(v.current * 100) / 100, v.pnl === null ? null : Math.round(v.pnl * 100) / 100, v.pnlPercent === null ? null : Math.round(v.pnlPercent * 100) / 100]
      .map(cell)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

function download(views: HoldingView[]) {
  const blob = new Blob([holdingsCsv(views)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `stocksphere-holdings-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Allocation and concentration for the member's holdings, per currency.
 * Information only — it describes the portfolio, it doesn't recommend trades.
 */
export default function PortfolioAnalytics({ views, unpriced }: { views: HoldingView[]; unpriced: number }) {
  const analytics = analysePortfolio(
    views.flatMap((v) => (v.quote && v.current !== null ? [{ symbol: v.symbol, currency: v.quote.currency, current: v.current, invested: v.invested }] : []))
  );

  if (analytics.length === 0) return null;

  return (
    <section className="mb-6 space-y-4">
      {analytics.map((a) => (
        <div key={a.currency} className="rounded-2xl border border-[#222] bg-[#111] p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Allocation · {a.currency}</h2>
            <span className="text-xs text-[#777]">
              {a.holdings} holdings · worth about {a.effectiveHoldings} equal-sized ones
            </span>
          </div>

          <ul className="mt-4 space-y-2">
            {a.allocations.map((item) => (
              <li key={item.symbol} className="grid grid-cols-[72px_minmax(0,1fr)_56px] items-center gap-3 text-sm sm:grid-cols-[96px_minmax(0,1fr)_64px_120px]">
                <span className="truncate font-semibold">{item.symbol}</span>
                <span className="h-2 overflow-hidden rounded-full bg-[#1d1d1d]" aria-hidden="true">
                  <span className="block h-full rounded-full bg-[#22c55e]/70" style={{ width: `${Math.max(item.weightPct, 1)}%` }} />
                </span>
                <span className="text-right tabular-nums text-[#ccc]">{item.weightPct.toFixed(1)}%</span>
                <span className={`hidden text-right tabular-nums sm:block ${toneClass(item.pnl)}`}>
                  {formatMoney(item.pnl, a.currency, true)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <p className="rounded-xl border border-[#1f1f1f] bg-[#0d0d0d] px-3 py-2.5">
              <span className="block text-xs text-[#888]">In profit / at a loss</span>
              <span className="font-semibold">
                {a.winners} / {a.losers}
              </span>
            </p>
            <p className="rounded-xl border border-[#1f1f1f] bg-[#0d0d0d] px-3 py-2.5">
              <span className="block text-xs text-[#888]">Best return</span>
              <span className="font-semibold">{a.best ? `${a.best.symbol} ${a.best.pnlPct! >= 0 ? "+" : ""}${a.best.pnlPct!.toFixed(2)}%` : "—"}</span>
            </p>
            <p className="rounded-xl border border-[#1f1f1f] bg-[#0d0d0d] px-3 py-2.5">
              <span className="block text-xs text-[#888]">Weakest return</span>
              <span className="font-semibold">{a.worst ? `${a.worst.symbol} ${a.worst.pnlPct! >= 0 ? "+" : ""}${a.worst.pnlPct!.toFixed(2)}%` : "—"}</span>
            </p>
          </div>

          {a.concentration && (
            <p className="mt-3 text-xs text-[#facc15]">
              {a.concentration === "single"
                ? "All of this money is in one holding."
                : `${a.allocations[0].symbol} is ${a.topWeightPct.toFixed(0)}% of this part of your portfolio${a.concentration === "high" ? " — a large share in one stock." : "."}`}
            </p>
          )}
        </div>
      ))}
      <button type="button" onClick={() => download(views)} className="rounded-lg border border-[#2a2a2a] px-3 py-1.5 text-xs text-[#ccc] hover:bg-[#1a1a1a]">
        Export holdings (CSV)
      </button>
      {unpriced > 0 && (
        <p className="text-xs text-[#888]">{unpriced} holding{unpriced === 1 ? " has" : "s have"} no live price and {unpriced === 1 ? "is" : "are"} left out of the allocation.</p>
      )}
      <p className="text-[11px] text-[#666]">Allocation uses live prices that may be delayed. For information only — not investment advice.</p>
    </section>
  );
}
