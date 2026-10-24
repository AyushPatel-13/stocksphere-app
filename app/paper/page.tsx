"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import AuthGuard from "@/components/AuthGuard";
import PriceChart from "@/components/Charts/PriceChart";
import { StockAvatar, toneClass } from "@/components/Markets/StockBits";
import InstrumentHeader, { useInstrumentQuote, type Instrument } from "@/components/Paper/InstrumentQuote";
import OrderPanel from "@/components/Paper/OrderPanel";
import SearchBox from "@/components/Search/SearchBox";
import { secondaryButtonClass } from "@/components/ui/Page";
import { formatMoney } from "@/lib/client/useQuotes";
import { computePositions, valuePosition, type PaperAssetType, type PaperCurrency, type PaperPosition } from "@/lib/paper/ledger";
import { loadPaperAccount, type PaperAccount } from "@/lib/paper/client";
import { canonicalStockSymbol } from "@/lib/search/canonical";
import type { SearchResult } from "@/lib/search/instruments";

/**
 * Paper trading: practise with virtual money (₹10,00,000 and $10,000).
 *
 * Laid out like a trading terminal: the selected instrument's price and chart
 * on the left, the order ticket on the right, and positions, trade history
 * and the account summary underneath. Market orders fill at StockSphere's
 * live price during market hours; the ledger can't be edited. No real money
 * or broker is involved.
 */

const DEFAULT_INSTRUMENT: Instrument = { assetType: "stock", symbol: "RELIANCE", name: "Reliance Industries" };

const ASSET_TYPES: PaperAssetType[] = ["stock", "etf", "crypto"];

async function livePrices(positions: PaperPosition[]): Promise<Record<string, number | null>> {
  const prices: Record<string, number | null> = {};
  const shares = positions.filter((p) => p.assetType !== "crypto" && p.quantity > 0).map((p) => p.symbol);
  const coins = positions.filter((p) => p.assetType === "crypto" && p.quantity > 0).map((p) => p.symbol);

  if (shares.length > 0) {
    try {
      const data = await (await fetch(`/api/watchlist/rows?symbols=${encodeURIComponent(shares.slice(0, 50).join(","))}`)).json();
      for (const row of data?.rows ?? []) prices[`stock|${row.symbol}`] = row.price;
    } catch {
      /* priced as unavailable */
    }
  }
  await Promise.all(
    coins.map(async (symbol) => {
      try {
        const data = await (await fetch(`/api/history?type=crypto&symbol=${encodeURIComponent(symbol)}&range=1d`)).json();
        prices[`crypto|${symbol}`] = data?.success ? data.candles?.at(-1)?.c ?? null : null;
      } catch {
        prices[`crypto|${symbol}`] = null;
      }
    })
  );
  return prices;
}

const priceKey = (p: { assetType: PaperAssetType; symbol: string }) => `${p.assetType === "crypto" ? "crypto" : "stock"}|${p.symbol}`;
const sameInstrument = (a: { assetType: PaperAssetType; symbol: string }, b: { assetType: PaperAssetType; symbol: string }) =>
  a.assetType === b.assetType && a.symbol === b.symbol;

/** The instrument in the address bar (?type=stock&symbol=TCS), so a refresh keeps it. */
function instrumentFromUrl(): Instrument | null {
  const params = new URLSearchParams(window.location.search);
  const symbol = params.get("symbol")?.trim().toUpperCase();
  const type = (params.get("type") ?? "stock") as PaperAssetType;
  if (!symbol || !ASSET_TYPES.includes(type) || !/^[A-Z0-9][A-Z0-9.&-]{0,19}$/.test(symbol)) return null;
  return { assetType: type, symbol, name: symbol };
}

function writeUrl(instrument: Instrument) {
  const url = new URL(window.location.href);
  url.searchParams.set("type", instrument.assetType);
  url.searchParams.set("symbol", instrument.symbol);
  window.history.replaceState(window.history.state, "", url);
}

type AccountState = { status: "loading" } | { status: "not-set-up" } | { status: "error" } | { status: "ready"; account: PaperAccount };

export default function PaperTradingPage() {
  const [state, setState] = useState<AccountState>({ status: "loading" });
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [attempt, setAttempt] = useState(0);
  const [instrument, setInstrument] = useState<Instrument | null>(null);
  const [tab, setTab] = useState<"positions" | "history">("positions");
  const [pickError, setPickError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPaperAccount()
      .then((result) => {
        if (cancelled) return;
        setState(result.status === "ready" ? { status: "ready", account: result.account } : { status: "not-set-up" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const positions = useMemo(() => (state.status === "ready" ? computePositions(state.account.trades) : []), [state]);
  const open = useMemo(() => positions.filter((p) => p.quantity > 0), [positions]);

  // First instrument: the address bar's, else the largest open position, else a default.
  useEffect(() => {
    if (instrument || state.status === "loading") return;
    const fromUrl = instrumentFromUrl();
    const first = open[0];
    const next = fromUrl ?? (first ? { assetType: first.assetType, symbol: first.symbol, name: first.symbol } : DEFAULT_INSTRUMENT);
    const timer = window.setTimeout(() => setInstrument(next), 0);
    return () => window.clearTimeout(timer);
  }, [instrument, state.status, open]);

  useEffect(() => {
    if (positions.every((p) => p.quantity <= 0)) return;
    let cancelled = false;
    livePrices(positions).then((result) => {
      if (!cancelled) setPrices(result);
    });
    return () => {
      cancelled = true;
    };
  }, [positions]);

  const quote = useInstrumentQuote(instrument);

  const select = useCallback((next: Instrument) => {
    setInstrument(next);
    setPickError(null);
    writeUrl(next);
  }, []);

  function choose(result: SearchResult) {
    const assetType: PaperAssetType | null = result.type === "stock" || result.type === "etf" || result.type === "crypto" ? result.type : null;
    if (!assetType) {
      setPickError("Paper trading covers stocks, ETFs and crypto.");
      return;
    }
    const symbol = assetType === "crypto" ? result.symbol.toUpperCase() : canonicalStockSymbol(result.symbol, result.market);
    select({ assetType, symbol, name: result.name });
  }

  function totals(currency: PaperCurrency) {
    const mine = positions.filter((p) => p.currency === currency);
    const valued = mine.filter((p) => p.quantity > 0).map((p) => valuePosition(p, prices[priceKey(p)] ?? null));
    const unknown = valued.some((v) => v.marketValue === null);
    const holdings = valued.reduce((sum, v) => sum + (v.marketValue ?? 0), 0);
    const unrealized = valued.reduce((sum, v) => sum + (v.unrealizedPnl ?? 0), 0);
    const realized = mine.reduce((sum, p) => sum + p.realizedPnl, 0);
    return { holdings, unrealized, realized, unknown, count: valued.length };
  }

  const held = instrument ? (positions.find((p) => sameInstrument(p, instrument))?.quantity ?? 0) : 0;
  const ready = state.status === "ready";
  const trades = ready ? state.account.trades : [];

  return (
    <AuthGuard>
      <main className="min-h-[calc(100vh_-_65px)] bg-black text-white">
        <div className="mx-auto w-full max-w-[1320px] px-4 pb-24 pt-6 sm:px-6 lg:px-8">
          <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#22c55e]">
                Paper trading
                <span className="rounded-full border border-[#2a2a2a] px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-[#999]">
                  Virtual money
                </span>
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">Practise with virtual money</h1>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
              <div className="w-full sm:flex-1 lg:w-[360px] lg:flex-none">
                <SearchBox
                  variant="compact"
                  inputId="paper-search"
                  placeholder="Search a stock, ETF or coin to trade…"
                  filterTypes={["stock", "etf", "crypto"]}
                  onSelect={choose}
                />
              </div>
              <Link href="/portfolio" className={`${secondaryButtonClass} shrink-0`}>
                Real portfolio →
              </Link>
            </div>
          </header>
          {pickError && (
            <p role="alert" className="-mt-2 mb-4 text-sm text-[#f87171]">
              {pickError}
            </p>
          )}

          {state.status === "not-set-up" ? (
            <div className="rounded-2xl border border-[#222] bg-[#111] px-6 py-12 text-center">
              <p className="text-2xl" aria-hidden="true">🧪</p>
              <p className="mt-3 font-semibold">Paper trading is launching soon</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-[#888]">It switches on once the paper trading database update is applied.</p>
            </div>
          ) : state.status === "error" ? (
            <div className="rounded-2xl border border-[#222] bg-[#111] px-6 py-10 text-center">
              <p className="text-sm text-[#888]">Your paper account couldn&apos;t be loaded right now.</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className={`${secondaryButtonClass} mt-3`}>
                Try again
              </button>
            </div>
          ) : (
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              {/* Instrument and chart */}
              <section aria-label="Selected instrument" className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
                {instrument ? (
                  <>
                    <div className="rounded-2xl border border-[#222] bg-[#111] p-4 sm:p-5">
                      <InstrumentHeader instrument={instrument} quote={quote} />
                    </div>
                    <PriceChart key={`${instrument.assetType}-${instrument.symbol}`} type={instrument.assetType} symbol={instrument.symbol} />
                  </>
                ) : (
                  <>
                    <div className="h-[104px] animate-pulse rounded-2xl bg-[#111]" />
                    <div className="h-[460px] animate-pulse rounded-2xl bg-[#0d0d0d]" />
                  </>
                )}
              </section>

              {/* Order ticket and account */}
              <aside aria-label="Order and account" className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1">
                {instrument ? (
                  <OrderPanel
                    key={`${instrument.assetType}-${instrument.symbol}`}
                    instrument={instrument}
                    quote={quote}
                    cash={ready ? state.account.cash : null}
                    held={held}
                    onFilled={() => setAttempt((n) => n + 1)}
                  />
                ) : (
                  <div className="h-[460px] animate-pulse rounded-2xl bg-[#111]" />
                )}

                <section aria-labelledby="paper-account" className="rounded-2xl border border-[#222] bg-[#111] p-5">
                  <h2 id="paper-account" className="text-sm font-semibold">
                    Virtual account
                  </h2>
                  {!ready ? (
                    <div className="mt-3 space-y-2">
                      <div className="h-4 animate-pulse rounded bg-[#1a1a1a]" />
                      <div className="h-4 animate-pulse rounded bg-[#1a1a1a]" />
                    </div>
                  ) : (
                    (["INR", "USD"] as const).map((currency) => {
                      const t = totals(currency);
                      return (
                        <dl key={currency} className="mt-3 space-y-1.5 border-t border-[#1d1d1d] pt-3 text-sm first-of-type:border-t-0 first-of-type:pt-0">
                          <div className="flex items-baseline justify-between gap-3">
                            <dt className="text-[#888]">Cash ({currency})</dt>
                            <dd className="min-w-0 break-all text-right font-semibold tabular-nums">{formatMoney(state.account.cash[currency], currency)}</dd>
                          </div>
                          <div className="flex items-baseline justify-between gap-3">
                            <dt className="text-[#888]">Holdings value</dt>
                            <dd className="min-w-0 break-all text-right tabular-nums text-[#ccc]">
                              {t.count === 0 ? formatMoney(0, currency) : t.unknown ? "Partly unavailable" : formatMoney(t.holdings, currency)}
                            </dd>
                          </div>
                          <div className="flex items-baseline justify-between gap-3">
                            <dt className="text-[#888]">Unrealised P&amp;L</dt>
                            <dd className={`min-w-0 break-all text-right tabular-nums ${toneClass(t.unrealized)}`}>{formatMoney(t.unrealized, currency, true)}</dd>
                          </div>
                          <div className="flex items-baseline justify-between gap-3">
                            <dt className="text-[#888]">Realised P&amp;L</dt>
                            <dd className={`min-w-0 break-all text-right tabular-nums ${toneClass(t.realized)}`}>{formatMoney(t.realized, currency, true)}</dd>
                          </div>
                        </dl>
                      );
                    })
                  )}
                </section>
              </aside>

              {/* Positions and history */}
              <section aria-label="Positions and trade history" className="min-w-0 overflow-hidden rounded-2xl border border-[#222] bg-[#111] lg:col-start-1 lg:row-start-2">
                <div className="flex border-b border-[#1d1d1d] px-2" role="tablist" aria-label="Account activity">
                  {(
                    [
                      ["positions", `Positions${ready ? ` (${open.length})` : ""}`],
                      ["history", `Trade history${ready ? ` (${trades.length})` : ""}`],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      id={`paper-tab-${id}`}
                      type="button"
                      role="tab"
                      aria-selected={tab === id}
                      aria-controls={`paper-panel-${id}`}
                      onClick={() => setTab(id)}
                      className={`-mb-px border-b-2 px-3 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#22c55e]/40 ${
                        tab === id ? "border-[#22c55e] text-white" : "border-transparent text-[#888] hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div id={`paper-panel-${tab}`} role="tabpanel" aria-labelledby={`paper-tab-${tab}`}>
                  {!ready ? (
                    <div className="space-y-2 p-5">
                      <div className="h-5 animate-pulse rounded bg-[#1a1a1a]" />
                      <div className="h-5 animate-pulse rounded bg-[#1a1a1a]" />
                    </div>
                  ) : tab === "positions" ? (
                    open.length === 0 ? (
                      <p className="px-5 py-10 text-center text-sm text-[#888]">No open positions. Place a buy order to start.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[520px] text-sm">
                          <thead className="border-b border-[#1d1d1d] bg-[#0f0f0f] text-xs text-[#888]">
                            <tr>
                              <th scope="col" className="px-4 py-3 text-left font-medium">Holding</th>
                              <th scope="col" className="px-3 py-3 text-right font-medium">Qty</th>
                              <th scope="col" className="px-3 py-3 text-right font-medium">Avg cost</th>
                              <th scope="col" className="px-3 py-3 text-right font-medium">Value</th>
                              <th scope="col" className="px-4 py-3 text-right font-medium">P&amp;L</th>
                            </tr>
                          </thead>
                          <tbody>
                            {open.map((p) => {
                              const v = valuePosition(p, prices[priceKey(p)] ?? null);
                              const current = instrument !== null && sameInstrument(p, instrument);
                              return (
                                <tr key={`${p.assetType}|${p.symbol}`} className={`border-b border-[#1b1b1b] last:border-b-0 ${current ? "bg-[#151515]" : "hover:bg-[#141414]"}`}>
                                  <td className="px-4 py-2.5">
                                    <button
                                      type="button"
                                      onClick={() => select({ assetType: p.assetType, symbol: p.symbol, name: p.symbol })}
                                      aria-label={`Trade ${p.symbol}`}
                                      aria-current={current || undefined}
                                      className="flex items-center gap-2.5 rounded text-left hover:text-[#22c55e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/40"
                                    >
                                      <StockAvatar symbol={p.symbol} size={28} type={p.assetType} />
                                      <span className="font-semibold">{p.symbol.replace(/\.(NS|BO)$/, "")}</span>
                                    </button>
                                  </td>
                                  <td className="px-3 py-2.5 text-right tabular-nums">{p.quantity}</td>
                                  <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(p.averageCost, p.currency)}</td>
                                  <td className="px-3 py-2.5 text-right tabular-nums">{v.marketValue === null ? "—" : formatMoney(v.marketValue, p.currency)}</td>
                                  <td className={`px-4 py-2.5 text-right tabular-nums ${toneClass(v.unrealizedPnl)}`}>
                                    {v.unrealizedPnl === null
                                      ? "—"
                                      : `${formatMoney(v.unrealizedPnl, p.currency, true)}${v.unrealizedPct !== null ? ` (${v.unrealizedPct.toFixed(2)}%)` : ""}`}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : trades.length === 0 ? (
                    <p className="px-5 py-10 text-center text-sm text-[#888]">No trades yet.</p>
                  ) : (
                    <ul>
                      {trades.slice(0, 50).map((t) => (
                        <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#1b1b1b] px-5 py-2.5 text-sm last:border-b-0">
                          <span
                            className={`w-12 rounded px-1.5 py-0.5 text-center text-[11px] font-bold ${
                              t.side === "buy" ? "bg-[#00b386]/15 text-[#00d49e]" : "bg-[#eb5b3c]/15 text-[#ff7a5c]"
                            }`}
                          >
                            {t.side === "buy" ? "BUY" : "SELL"}
                          </span>
                          <span className="font-semibold">{t.symbol.replace(/\.(NS|BO)$/, "")}</span>
                          <span className="tabular-nums text-[#ccc]">
                            {t.quantity} × {formatMoney(t.price, t.currency)}
                          </span>
                          <span className="tabular-nums text-[#888]">= {formatMoney(t.quantity * t.price, t.currency)}</span>
                          <span className="ml-auto text-xs text-[#777]">
                            {new Date(t.executedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
    </AuthGuard>
  );
}
