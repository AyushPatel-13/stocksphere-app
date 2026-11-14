"use client";

import { useEffect, useState } from "react";

import {
  STATEMENT_LINES,
  formatPerShare,
  formatStatementMoney,
  growth,
  netMargin,
  periodLabel,
  type StatementId,
  type StatementPeriod,
  type Statements,
} from "@/lib/apis/yahooStatements";

/**
 * A stock's reported financial statements: income, balance sheet and cash
 * flow, by fiscal year or by quarter. Figures are the company's reported
 * ones from /api/financials; the two calculated rows (growth and net margin)
 * are marked as calculated. A line the source has no figure for shows "—",
 * and a statement with no figures at all isn't offered.
 */

type State = { status: "loading" } | { status: "none" } | { status: "ready"; data: Statements & { source: string } };

const TABS: { id: StatementId; label: string }[] = [
  { id: "income", label: "Income" },
  { id: "balance", label: "Balance sheet" },
  { id: "cashflow", label: "Cash flow" },
];

const percent = (value: number | null) => (value === null ? "—" : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}%`);

function hasFigures(periods: StatementPeriod[], statement: StatementId): boolean {
  return STATEMENT_LINES.some((line) => line.statement === statement && periods.some((period) => period.values[line.id] !== null));
}

function Toggle<T extends string>({ label, options, value, onChange }: { label: string; options: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-lg border border-[#262626] bg-[#0d0d0d] p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          onClick={() => onChange(option.id)}
          className={`min-h-9 rounded-md px-3 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-green-500 ${
            value === option.id ? "bg-[#1f1f1f] text-white" : "text-[#999] hover:text-white"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default function Financials({ symbol }: { symbol: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [statement, setStatement] = useState<StatementId>("income");
  const [kind, setKind] = useState<"annual" | "quarterly">("annual");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/financials?symbol=${encodeURIComponent(symbol)}`)
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setState(data?.success ? { status: "ready", data } : { status: "none" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "none" });
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (state.status === "loading") {
    return (
      <section aria-label="Financials" className="mt-10" aria-busy="true">
        <h2 className="mb-4 text-[22px] font-bold tracking-tight sm:text-[26px]">Financials</h2>
        <div className="h-64 animate-pulse rounded-2xl border border-[#222] bg-[#111] motion-reduce:animate-none" />
      </section>
    );
  }

  if (state.status === "none") {
    return (
      <section aria-label="Financials" className="mt-10">
        <h2 className="mb-4 text-[22px] font-bold tracking-tight sm:text-[26px]">Financials</h2>
        <p className="rounded-2xl border border-[#222] bg-[#111] px-5 py-6 text-sm text-[#999]">
          Financial statements aren&apos;t available for this stock right now.
        </p>
      </section>
    );
  }

  const { data } = state;
  // Prefer what was asked for; fall back to the other period type rather than an empty table.
  const available = (["annual", "quarterly"] as const).filter((k) => hasFigures(data[k], statement));
  const shownKind = available.includes(kind) ? kind : available[0];
  const periods = shownKind ? data[shownKind] : [];
  const lines = STATEMENT_LINES.filter((line) => line.statement === statement && periods.some((period) => period.values[line.id] !== null));
  const format = (value: number | null, unit: "money" | "perShare") => (unit === "money" ? formatStatementMoney(value, data.currency) : formatPerShare(value, data.currency));

  return (
    <section aria-label="Financials" className="mt-10">
      <h2 className="mb-4 text-[22px] font-bold tracking-tight sm:text-[26px]">Financials</h2>

      <div className="rounded-2xl border border-[#222] bg-[#111] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Toggle label="Statement" options={TABS} value={statement} onChange={setStatement} />
          <Toggle
            label="Period"
            options={[
              { id: "annual", label: "Annual" },
              { id: "quarterly", label: "Quarterly" },
            ]}
            value={shownKind ?? kind}
            onChange={setKind}
          />
        </div>

        {!shownKind ? (
          <p className="py-8 text-center text-sm text-[#999]">The source has no {TABS.find((tab) => tab.id === statement)!.label.toLowerCase()} figures for this stock.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <caption className="sr-only">
                {TABS.find((tab) => tab.id === statement)!.label}, {shownKind === "annual" ? "by fiscal year" : "by quarter"}
              </caption>
              <thead>
                <tr className="border-b border-[#222] text-[#888]">
                  <th scope="col" className="py-2 pr-3 text-left font-medium">
                    {shownKind === "annual" ? "Fiscal year ending" : "Quarter ending"}
                  </th>
                  {periods.map((period) => (
                    <th key={period.asOf} scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">
                      {periodLabel(period.asOf, shownKind)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-b border-[#1a1a1a]">
                    <th scope="row" className="py-2.5 pr-3 text-left font-normal text-[#ccc]">
                      {line.label}
                    </th>
                    {periods.map((period) => {
                      const value = period.values[line.id];
                      return (
                        <td key={period.asOf} className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${value !== null && value < 0 ? "text-[#f87171]" : "text-white"}`}>
                          {format(value, line.unit)}
                        </td>
                      );
                    })}
                  </tr>
                ))}

                {statement === "income" && lines.some((line) => line.id === "revenue") && (
                  <>
                    <tr className="border-b border-[#1a1a1a] text-[#999]">
                      <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                        Revenue growth <span className="text-[#666]">(calculated)</span>
                      </th>
                      {periods.map((period, index) => (
                        <td key={period.asOf} className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                          {percent(index === 0 ? null : growth(period.values.revenue, periods[index - 1].values.revenue))}
                        </td>
                      ))}
                    </tr>
                    <tr className="text-[#999]">
                      <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                        Net margin <span className="text-[#666]">(calculated)</span>
                      </th>
                      {periods.map((period) => {
                        const margin = netMargin(period);
                        return (
                          <td key={period.asOf} className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                            {margin === null ? "—" : `${margin.toFixed(1)}%`}
                          </td>
                        );
                      })}
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs leading-relaxed text-[#777]">
          As reported by the company{data.currency ? `, in ${data.currency}` : ""}. Source: {data.source}. Growth is against the previous {shownKind === "quarterly" ? "quarter shown" : "year"}; net
          margin is net income ÷ revenue. “—” means the source has no figure. Not investment advice.
        </p>
      </div>
    </section>
  );
}
