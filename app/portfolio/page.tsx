"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import HoldingForm from "@/components/Portfolio/HoldingForm";
import PortfolioAnalytics from "@/components/Portfolio/PortfolioAnalytics";
import AuthGuard from "@/components/AuthGuard";
import MarketsNav from "@/components/Markets/MarketsNav";
import { Change, StockAvatar, absPercent, toneClass } from "@/components/Markets/StockBits";
import {
  EmptyState,
  PageShell,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/Page";
import {
  summariseHoldings,
  toHoldingView,
  type HoldingRow,
  type HoldingView,
} from "@/lib/client/holdings";
import { formatMoney, useQuotes } from "@/lib/client/useQuotes";
import { getPortfolio, removeHolding } from "@/lib/portfolio";

/**
 * Holdings.
 *
 * Every figure follows the rules this page has always had: prices come from
 * /api/market (via useQuotes), a holding nobody could price shows
 * "Unavailable" and is never valued at zero, and totals are kept per currency —
 * rupees and dollars are never added together.
 */

type SortKey = "company" | "price" | "returns" | "current";

function sortValue(view: HoldingView, key: SortKey): number | string {
  switch (key) {
    case "company":
      return view.symbol;
    case "price":
      return view.quote?.changePercent ?? -Infinity;
    case "returns":
      return view.pnlPercent ?? -Infinity;
    case "current":
      return view.current ?? -Infinity;
  }
}

function Unavailable() {
  return (
    <span className="rounded-full border border-[#262626] bg-[#171717] px-2 py-0.5 text-xs text-[#8a8a8a]">
      Unavailable
    </span>
  );
}

function SortButton({
  label,
  k,
  sort,
  onSort,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === k;

  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      className={`inline-flex items-center gap-1 hover:text-white ${active ? "text-white" : ""}`}
    >
      {label}
      <span aria-hidden="true" className="text-[9px]">
        {active ? (sort.desc ? "▼" : "▲") : "▾"}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function PortfolioPage() {
  const [rows, setRows] = useState<HoldingRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "current", desc: true });

  async function refresh() {
    try {
      setRows((await getPortfolio()) as HoldingRow[]);
      setLoadFailed(false);
    } catch (error) {
      console.error("Portfolio load error:", error);
      setLoadFailed(true);
      setRows((current) => current ?? []);
    }
  }

  useEffect(() => {
    let cancelled = false;

    getPortfolio()
      .then((data) => {
        if (!cancelled) setRows(data as HoldingRow[]);
      })
      .catch((error) => {
        console.error("Portfolio load error:", error);
        if (!cancelled) {
          setLoadFailed(true);
          setRows([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const symbols = useMemo(() => (rows ?? []).map((row) => row.symbol), [rows]);
  const { loading: quotesLoading, quotes } = useQuotes(symbols);

  const views = (rows ?? []).map((row) =>
    toHoldingView(row, quotes[String(row.symbol).toUpperCase()] ?? null)
  );
  const { totals, unpriced } = summariseHoldings(views);

  const sorted = [...views].sort((a, b) => {
    const x = sortValue(a, sort.key);
    const y = sortValue(b, sort.key);
    const order =
      typeof x === "string" && typeof y === "string"
        ? x.localeCompare(y)
        : (x as number) - (y as number);
    return sort.desc ? -order : order;
  });

  function sortBy(key: SortKey) {
    setSort((current) =>
      current.key === key ? { key, desc: !current.desc } : { key, desc: key !== "company" }
    );
  }

  async function remove(view: HoldingView) {
    if (!window.confirm(`Remove ${view.symbol} from your holdings? This deletes your record only; nothing is sold.`)) return;
    await removeHolding(view.id);
    await refresh();
  }

  const count = rows?.length ?? 0;
  const showTotals = !quotesLoading && unpriced === 0 && totals.length > 0;

  return (
    <AuthGuard>
      <PageShell>
        <MarketsNav />

        {/* Summary */}
        <section className="mb-6 rounded-2xl border border-[#222] bg-[#111] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#888]">
              Holdings ({count})
            </p>
            <button
              type="button"
              onClick={() => setShowForm((open) => !open)}
              className={secondaryButtonClass}
            >
              {showForm ? "Close" : "+ Record holding"}
            </button>
          </div>

          {rows === null || (quotesLoading && count > 0) ? (
            <div className="mt-3 space-y-3">
              <div className="h-8 w-48 animate-pulse rounded-lg bg-[#1a1a1a]" />
              <div className="h-12 animate-pulse rounded-lg bg-[#161616]" />
            </div>
          ) : count === 0 ? (
            <p className="mt-3 text-sm text-[#888]">Nothing here yet.</p>
          ) : !showTotals ? (
            <p className="mt-3 text-sm text-[#888]">
              {unpriced === 1 ? "1 holding" : `${unpriced} holdings`} couldn&apos;t be priced right now,
              so totals are hidden rather than shown incomplete.
            </p>
          ) : (
            totals.map((total) => (
              <div key={total.currency} className="mt-2">
                <p className="text-[28px] font-semibold tabular-nums tracking-tight">
                  {formatMoney(total.current, total.currency)}
                </p>
                <dl className="mt-4 grid grid-cols-1 gap-4 border-t border-[#1f1f1f] pt-4 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-[#888]">Invested value</dt>
                    <dd className="mt-1 text-base font-medium tabular-nums">
                      {formatMoney(total.invested, total.currency)}
                    </dd>
                  </div>
                  <div className="sm:text-center">
                    <dt className="text-[#888]">1D returns</dt>
                    <dd className={`mt-1 text-base font-medium tabular-nums ${toneClass(total.dayChange)}`}>
                      {total.dayChange === null
                        ? "—"
                        : `${formatMoney(total.dayChange, total.currency, true)} (${absPercent(total.dayChangePercent)})`}
                    </dd>
                  </div>
                  <div className="sm:text-right">
                    <dt className="text-[#888]">Total returns</dt>
                    <dd className={`mt-1 text-base font-medium tabular-nums ${toneClass(total.pnl)}`}>
                      {formatMoney(total.pnl, total.currency, true)} ({absPercent(total.pnlPercent)})
                    </dd>
                  </div>
                </dl>
              </div>
            ))
          )}
        </section>

        <p className="mb-6 flex items-start gap-2 rounded-xl border border-[#2a2a2a] bg-[#151515] px-4 py-3 text-[13px] leading-relaxed text-[#8a8a8a]">
          <span aria-hidden="true" className="mt-px text-[#666]">
            ⓘ
          </span>
          <span>
            These are holdings you record yourself. They aren&apos;t synced with a broker, and StockSphere doesn&apos;t place real orders. Open a
            holding for its chart and details. Simulated trades live separately in{" "}
            <Link href="/paper" className="font-medium text-[#22c55e] hover:text-[#4ade80]">
              Paper Trading
            </Link>
            .
          </span>
        </p>

        {!quotesLoading && <PortfolioAnalytics views={views} unpriced={unpriced} />}

        {showForm && (
          <section aria-label="Record a holding" className="mb-6 rounded-2xl border border-[#222] bg-[#111] p-5">
            <p className="mb-4 font-semibold">Record a holding</p>
            <HoldingForm
              onCancel={() => setShowForm(false)}
              onSaved={async () => {
                await refresh();
                setShowForm(false);
              }}
            />
          </section>
        )}

        {editing && (() => {
          const view = views.find((v) => v.id === editing);
          return view ? (
            <section aria-label={`Edit ${view.symbol}`} className="mb-6 rounded-2xl border border-[#222] bg-[#111] p-5">
              <p className="mb-4 font-semibold">Edit {view.symbol}</p>
              <HoldingForm
                key={view.id}
                editing={{ id: view.id, symbol: view.symbol, quantity: view.quantity, avgPrice: view.avgPrice }}
                onCancel={() => setEditing(null)}
                onSaved={async () => {
                  await refresh();
                  setEditing(null);
                }}
              />
            </section>
          ) : null;
        })()}

        {loadFailed && (
          <p role="status" className="mb-6 rounded-xl border border-[#3a2020] bg-[#1a1111] px-4 py-3 text-sm text-[#f0a0a0]">
            Your holdings couldn&apos;t be loaded right now.
          </p>
        )}

        {rows !== null && count === 0 && !loadFailed && !showForm && (
          <EmptyState
            icon="💼"
            title="Record your first holding"
            description="Enter the stocks you already own to track their live value, daily change and total returns. Recording a holding doesn't buy anything."
            action={
              <button type="button" onClick={() => setShowForm(true)} className={primaryButtonClass}>
                + Record holding
              </button>
            }
          />
        )}

        {count > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-[#222] bg-[#111]">
            <table className="w-full text-sm">
              <thead className="border-b border-[#222] bg-[#0f0f0f] text-xs text-[#888]">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium">
                    <SortButton label="Company" k="company" sort={sort} onSort={sortBy} />
                  </th>
                  <th scope="col" className="hidden px-4 py-3 text-right font-medium sm:table-cell">
                    <SortButton label="Market price (1D%)" k="price" sort={sort} onSort={sortBy} />
                  </th>
                  <th scope="col" className="hidden px-4 py-3 text-right font-medium md:table-cell">
                    <SortButton label="Returns (%)" k="returns" sort={sort} onSort={sortBy} />
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    <SortButton label="Current (Invested)" k="current" sort={sort} onSort={sortBy} />
                  </th>
                  <th scope="col" className="w-20 px-2 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>

              <tbody>
                {sorted.map((view) => {
                  const currency = view.quote?.currency ?? "INR";

                  return (
                    <tr
                      key={view.id}
                      className="group border-b border-[#1b1b1b] transition-colors last:border-b-0 hover:bg-[#151515]"
                    >
                      <td className="px-4 py-3.5">
                        <Link href={`/stock/${encodeURIComponent(view.symbol)}`} className="flex items-center gap-3">
                          <StockAvatar symbol={view.symbol} size={36} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold group-hover:text-[#22c55e]">
                              {view.symbol}
                            </span>
                            <span className="block text-xs text-[#777]">
                              {view.quantity} {view.quantity === 1 ? "share" : "shares"} · Avg.{" "}
                              {formatMoney(view.avgPrice, currency)}
                            </span>
                          </span>
                        </Link>
                      </td>

                      <td className="hidden px-4 py-3.5 text-right sm:table-cell">
                        {quotesLoading && !view.quote ? (
                          <span className="ml-auto block h-4 w-20 animate-pulse rounded bg-[#1c1c1c]" />
                        ) : view.quote ? (
                          <>
                            <span className="block font-medium tabular-nums">
                              {formatMoney(view.quote.price, currency)}
                            </span>
                            <span className="block text-xs">
                              <Change change={view.quote.change} percent={view.quote.changePercent} />
                            </span>
                            {view.dayChange !== null && (
                              <span className={`block text-[11px] tabular-nums ${toneClass(view.dayChange)}`}>
                                1D {formatMoney(view.dayChange, currency, true)}
                              </span>
                            )}
                          </>
                        ) : (
                          <Unavailable />
                        )}
                      </td>

                      <td className="hidden px-4 py-3.5 text-right md:table-cell">
                        {view.pnl === null ? (
                          quotesLoading ? (
                            <span className="ml-auto block h-4 w-16 animate-pulse rounded bg-[#1c1c1c]" />
                          ) : (
                            <span className="text-[#666]">—</span>
                          )
                        ) : (
                          <span className={toneClass(view.pnl)}>
                            <span className="block font-medium tabular-nums">
                              {formatMoney(view.pnl, currency, true)}
                            </span>
                            <span className="block text-xs tabular-nums">{absPercent(view.pnlPercent)}</span>
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-right">
                        <span className="block font-medium tabular-nums">
                          {view.current === null ? (
                            quotesLoading ? (
                              <span className="ml-auto block h-4 w-20 animate-pulse rounded bg-[#1c1c1c]" />
                            ) : (
                              <Unavailable />
                            )
                          ) : (
                            formatMoney(view.current, currency)
                          )}
                        </span>
                        <span className="block text-xs tabular-nums text-[#777]">
                          {formatMoney(view.invested, currency)}
                        </span>
                        {/* Returns move under the value on narrow screens. */}
                        {view.pnl !== null && (
                          <span className={`block text-xs tabular-nums md:hidden ${toneClass(view.pnl)}`}>
                            {formatMoney(view.pnl, currency, true)} ({absPercent(view.pnlPercent)})
                          </span>
                        )}
                      </td>

                      <td className="whitespace-nowrap px-2 py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setShowForm(false);
                            setEditing(view.id);
                          }}
                          aria-label={`Edit ${view.symbol}`}
                          className="rounded-lg p-2 text-[#666] opacity-100 transition-colors hover:bg-[#1c1c1c] hover:text-white sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(view)}
                          aria-label={`Remove ${view.symbol}`}
                          className="rounded-lg p-2 text-[#666] opacity-100 transition-colors hover:bg-[#2a1414] hover:text-[#f87171] sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageShell>
    </AuthGuard>
  );
}
