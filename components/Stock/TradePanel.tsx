"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useInstrumentQuote, type Instrument } from "@/components/Paper/InstrumentQuote";
import OrderPanel from "@/components/Paper/OrderPanel";
import HoldingForm from "@/components/Portfolio/HoldingForm";
import { absPercent, toneClass } from "@/components/Markets/StockBits";
import { secondaryButtonClass } from "@/components/ui/Page";
import { toHoldingView, type HoldingRow } from "@/lib/client/holdings";
import { formatMoney, useQuotes } from "@/lib/client/useQuotes";
import { computePositions } from "@/lib/paper/ledger";
import { loadPaperAccount, type AccountLoad } from "@/lib/paper/client";
import { getPortfolio, removeHolding } from "@/lib/portfolio";
import { supabase } from "@/lib/supabase";

/**
 * The stock page's right-hand panel. Two clearly separate things:
 *
 *   Paper trade    — a simulated order with virtual cash (the same ticket as
 *                    the Paper Trading page). Never touches real holdings.
 *   My holdings    — the user's own record of shares they hold elsewhere:
 *                    view, record, correct or remove. Not an order.
 *
 * StockSphere has no broker connection, so there is no real buy/sell, and the
 * panel says so rather than offering a button that would pretend.
 */

type Mode = "paper" | "holdings";

const bare = (symbol: string) => symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, "");

export default function TradePanel({ symbol, name }: { symbol: string; name: string }) {
  const instrument = useMemo<Instrument>(() => ({ assetType: "stock", symbol: symbol.toUpperCase(), name }), [symbol, name]);
  const [mode, setMode] = useState<Mode>("paper");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [paper, setPaper] = useState<AccountLoad | "loading" | "error">("loading");
  const [rows, setRows] = useState<HoldingRow[] | null>(null);
  const [rowsFailed, setRowsFailed] = useState(false);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const quote = useInstrumentQuote(instrument);

  const loadPaper = useCallback(() => {
    loadPaperAccount()
      .then(setPaper)
      .catch(() => setPaper("error"));
  }, []);

  const loadRows = useCallback(async () => {
    try {
      const data = (await getPortfolio()) as HoldingRow[];
      setRows(data.filter((row) => bare(String(row.symbol)) === bare(symbol)));
      setRowsFailed(false);
    } catch {
      setRowsFailed(true);
      setRows((current) => current ?? []);
    }
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setSignedIn(Boolean(data.user));
      if (data.user) {
        loadPaper();
        loadRows();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadPaper, loadRows]);

  const holdingSymbols = useMemo(() => (rows && rows.length > 0 ? [rows[0].symbol] : []), [rows]);
  const { loading: quotesLoading, quotes } = useQuotes(holdingSymbols);
  const views = (rows ?? []).map((row) => toHoldingView(row, quotes[String(row.symbol).toUpperCase()] ?? null));

  const paperAccount = typeof paper === "object" && paper.status === "ready" ? paper.account : null;
  const paperPosition = paperAccount
    ? computePositions(paperAccount.trades).find((p) => p.assetType !== "crypto" && bare(p.symbol) === bare(symbol))
    : undefined;

  if (signedIn === false) {
    return (
      <section aria-label="Trade" className="rounded-2xl border border-[#222] bg-[#111] p-5">
        <p className="font-semibold">Trade {bare(symbol)}</p>
        <p className="mt-2 text-sm leading-relaxed text-[#888]">
          Sign in to practise with virtual money or to record the shares you hold.
        </p>
        <Link href="/login" className={`${secondaryButtonClass} mt-4 w-full`}>
          Sign in
        </Link>
      </section>
    );
  }

  return (
    <section aria-label="Trade and holdings" className="space-y-3">
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-[#222] bg-[#0d0d0d] p-1" role="group" aria-label="Panel">
        {(
          [
            ["paper", "Paper trade"],
            ["holdings", "My holdings"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => setMode(id)}
            className={`rounded-lg py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/40 ${
              mode === id ? "bg-[#1f1f1f] text-white" : "text-[#888] hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "paper" ? (
        <>
          <p className="flex items-start gap-2 rounded-xl border border-[#2a2a2a] bg-[#151515] px-3.5 py-2.5 text-xs leading-relaxed text-[#999]">
            <span aria-hidden="true">🧪</span>
            <span>Simulated with virtual money. Paper trades never change your real holdings.</span>
          </p>
          {paper === "loading" || signedIn === null ? (
            <div className="h-[420px] animate-pulse rounded-2xl bg-[#111]" />
          ) : paper === "error" ? (
            <div className="rounded-2xl border border-[#222] bg-[#111] p-5 text-sm text-[#888]">
              Your paper account couldn&apos;t be loaded.{" "}
              <button type="button" onClick={loadPaper} className="font-semibold text-[#22c55e] hover:text-[#4ade80]">
                Try again
              </button>
            </div>
          ) : paper.status !== "ready" ? (
            <div className="rounded-2xl border border-[#222] bg-[#111] p-5 text-sm text-[#888]">Paper trading is launching soon.</div>
          ) : (
            <OrderPanel
              instrument={instrument}
              quote={quote}
              cash={paper.account.cash}
              held={paperPosition?.quantity ?? 0}
              onFilled={loadPaper}
            />
          )}
          {paperAccount && (
            <p className="px-1 text-xs text-[#888]">
              {paperPosition && paperPosition.quantity > 0
                ? `Paper position: ${paperPosition.quantity} at avg ${formatMoney(paperPosition.averageCost, paperPosition.currency)}. `
                : ""}
              <Link href={`/paper?type=stock&symbol=${encodeURIComponent(instrument.symbol)}`} className="font-medium text-[#22c55e] hover:text-[#4ade80]">
                Open Paper Trading →
              </Link>
            </p>
          )}
        </>
      ) : (
        <div className="rounded-2xl border border-[#222] bg-[#111] p-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-semibold">Your {bare(symbol)} holdings</p>
            <Link href="/portfolio" className="shrink-0 text-xs font-medium text-[#22c55e] hover:text-[#4ade80]">
              Portfolio →
            </Link>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[#777]">
            Recorded by you, not synced with a broker. StockSphere can&apos;t place real orders.
          </p>

          {rows === null ? (
            <div className="mt-4 h-20 animate-pulse rounded-xl bg-[#161616]" />
          ) : (
            <>
              {rowsFailed && <p className="mt-3 text-sm text-[#f87171]">Your holdings couldn&apos;t be loaded right now.</p>}
              {views.length === 0 && !rowsFailed && editing !== "new" && (
                <p className="mt-4 text-sm text-[#888]">You haven&apos;t recorded any {bare(symbol)} shares.</p>
              )}
              <ul className="mt-3 space-y-3">
                {views.map((view) => {
                  const currency = view.quote?.currency ?? (quote.currency ?? "INR");
                  return (
                    <li key={view.id} className="rounded-xl border border-[#1f1f1f] bg-[#0d0d0d] p-3.5">
                      {editing === view.id ? (
                        <HoldingForm
                          compact
                          editing={{ id: view.id, symbol: view.symbol, quantity: view.quantity, avgPrice: view.avgPrice }}
                          onCancel={() => setEditing(null)}
                          onSaved={async () => {
                            await loadRows();
                            setEditing(null);
                          }}
                        />
                      ) : (
                        <>
                          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                            <Figure label="Quantity" value={String(view.quantity)} />
                            <Figure label="Avg. price" value={formatMoney(view.avgPrice, currency)} />
                            <Figure label="Invested" value={formatMoney(view.invested, currency)} />
                            <Figure
                              label="Current value"
                              value={view.current !== null ? formatMoney(view.current, currency) : quotesLoading ? "…" : "Unavailable"}
                            />
                            <Figure
                              label="1D change"
                              tone={view.dayChange}
                              value={view.dayChange !== null ? formatMoney(view.dayChange, currency, true) : quotesLoading ? "…" : "—"}
                            />
                            <Figure
                              label="Unrealised P&L"
                              tone={view.pnl}
                              value={view.pnl !== null ? `${formatMoney(view.pnl, currency, true)} (${absPercent(view.pnlPercent)})` : quotesLoading ? "…" : "—"}
                            />
                          </dl>
                          <div className="mt-3 flex gap-2">
                            <button type="button" onClick={() => setEditing(view.id)} className={`${secondaryButtonClass} flex-1 py-1.5 text-xs`}>
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!window.confirm(`Remove this ${view.symbol} record from your holdings? This only deletes your record.`)) return;
                                await removeHolding(view.id);
                                await loadRows();
                              }}
                              className={`${secondaryButtonClass} flex-1 py-1.5 text-xs hover:text-[#f87171]`}
                            >
                              Remove
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>

              {editing === "new" ? (
                <div className="mt-4 border-t border-[#1d1d1d] pt-4">
                  <HoldingForm
                    compact
                    fixedSymbol={symbol.toUpperCase()}
                    onCancel={() => setEditing(null)}
                    onSaved={async () => {
                      await loadRows();
                      setEditing(null);
                    }}
                  />
                </div>
              ) : (
                <button type="button" onClick={() => setEditing("new")} className={`${secondaryButtonClass} mt-4 w-full`}>
                  + Record a holding
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: number | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-[#777]">{label}</dt>
      <dd className={`break-words font-medium tabular-nums ${tone !== undefined ? toneClass(tone) : ""}`}>{value}</dd>
    </div>
  );
}
