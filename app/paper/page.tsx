"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import AuthGuard from "@/components/AuthGuard";
import { StockAvatar, toneClass } from "@/components/Markets/StockBits";
import SearchBox from "@/components/Search/SearchBox";
import { PageHeader, PageShell, StatCard, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/Page";
import { formatMoney } from "@/lib/client/useQuotes";
import { computePositions, valuePosition, type PaperAssetType, type PaperCurrency, type PaperPosition, type PaperSide } from "@/lib/paper/ledger";
import { loadPaperAccount, submitPaperOrder, type PaperAccount } from "@/lib/paper/client";
import { canonicalStockSymbol } from "@/lib/search/canonical";
import type { SearchResult } from "@/lib/search/instruments";

/**
 * Paper trading: practise with virtual money (₹10,00,000 and $10,000).
 * Market orders fill at StockSphere's live price during market hours; the
 * ledger can't be edited. No real money or broker is involved.
 */

type Pick = { assetType: PaperAssetType; symbol: string; name: string };

function newRequestId() {
  return crypto.randomUUID();
}

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

function OrderForm({ onFilled }: { onFilled: () => void }) {
  const [pick, setPick] = useState<Pick | null>(null);
  const [side, setSide] = useState<PaperSide>("buy");
  const [quantity, setQuantity] = useState("1");
  const [requestId, setRequestId] = useState(newRequestId);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  function choose(result: SearchResult) {
    const assetType: PaperAssetType | null = result.type === "stock" || result.type === "etf" || result.type === "crypto" ? result.type : null;
    if (!assetType) {
      setMessage({ tone: "error", text: "Paper trading covers stocks, ETFs and crypto." });
      return;
    }
    const symbol = assetType === "crypto" ? result.symbol.toUpperCase() : canonicalStockSymbol(result.symbol, result.market);
    setPick({ assetType, symbol, name: result.name });
    setMessage(null);
  }

  async function submit() {
    if (!pick) {
      setMessage({ tone: "error", text: "Pick something to trade." });
      return;
    }
    setSaving(true);
    setMessage(null);
    const result = await submitPaperOrder({ requestId, assetType: pick.assetType, symbol: pick.symbol, side, quantity: Number(quantity) });
    setSaving(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.code === "NOT_CONFIGURED" ? "Paper trading is launching soon." : result.error });
      return;
    }
    setRequestId(newRequestId());
    setMessage({ tone: "ok", text: `${side === "buy" ? "Bought" : "Sold"} ${quantity} ${pick.symbol} at ${formatMoney(result.price, result.currency)}.` });
    onFilled();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="rounded-2xl border border-[#222] bg-[#111] p-5"
    >
      <p className="font-semibold">Place a virtual order</p>
      <div className="mt-3">
        <SearchBox variant="compact" inputId="paper-search" placeholder="Search a stock, ETF or coin…" filterTypes={["stock", "etf", "crypto"]} onSelect={choose} />
      </div>
      {pick && (
        <p className="mt-2 text-sm">
          <span className="font-semibold">{pick.symbol}</span> <span className="text-[#888]">{pick.name}</span>
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Side">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            onClick={() => setSide(s)}
            className={`rounded-xl border py-2.5 text-sm font-semibold ${
              side === s
                ? s === "buy"
                  ? "border-[#22c55e]/60 bg-[#22c55e]/15 text-[#4ade80]"
                  : "border-[#ef4444]/60 bg-[#ef4444]/15 text-[#f87171]"
                : "border-[#2a2a2a] text-[#999] hover:text-white"
            }`}
          >
            {s === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-xs font-medium text-[#888]">Quantity</span>
        <input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" className={inputClass} />
      </label>

      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 text-sm ${message.tone === "error" ? "text-[#f87171]" : "text-[#4ade80]"}`}>
          {message.text}
        </p>
      )}

      <button type="submit" disabled={saving} className={`${primaryButtonClass} mt-4 w-full`}>
        {saving ? "Placing…" : `Place ${side} order`}
      </button>
      <p className="mt-2 text-[11px] text-[#666]">
        Market orders fill at StockSphere&apos;s latest price (which may be delayed) during market hours. Virtual money only — not investment advice.
      </p>
    </form>
  );
}

export default function PaperTradingPage() {
  const [state, setState] = useState<{ status: "loading" } | { status: "not-set-up" } | { status: "error" } | { status: "ready"; account: PaperAccount }>({ status: "loading" });
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [attempt, setAttempt] = useState(0);

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

  const open = positions.filter((p) => p.quantity > 0);

  function totals(currency: PaperCurrency) {
    const mine = positions.filter((p) => p.currency === currency);
    const valued = mine.filter((p) => p.quantity > 0).map((p) => valuePosition(p, prices[priceKey(p)] ?? null));
    const unknown = valued.some((v) => v.marketValue === null);
    const holdings = valued.reduce((sum, v) => sum + (v.marketValue ?? 0), 0);
    const unrealized = valued.reduce((sum, v) => sum + (v.unrealizedPnl ?? 0), 0);
    const realized = mine.reduce((sum, p) => sum + p.realizedPnl, 0);
    return { holdings, unrealized, realized, unknown };
  }

  return (
    <AuthGuard>
      <PageShell>
        <PageHeader
          eyebrow="Paper trading"
          title="Practise with virtual money"
          description="Start with ₹10,00,000 and $10,000 of virtual cash. Trade at real prices with no real money at risk."
          actions={
            <Link href="/portfolio" className={secondaryButtonClass}>
              Real portfolio →
            </Link>
          }
        />

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
          <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
            <aside>
              <OrderForm onFilled={() => setAttempt((n) => n + 1)} />
            </aside>

            <div className="min-w-0 space-y-6">
              {state.status === "loading" ? (
                <div className="h-28 animate-pulse rounded-2xl bg-[#111]" />
              ) : (
                (["INR", "USD"] as const).map((currency) => {
                  const t = totals(currency);
                  return (
                    <div key={currency} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <StatCard label={`Cash (${currency})`} value={formatMoney(state.account.cash[currency], currency)} />
                      <StatCard label="Holdings value" value={t.unknown ? "Partly unavailable" : formatMoney(t.holdings, currency)} />
                      <StatCard label="Unrealised P&L" value={formatMoney(t.unrealized, currency, true)} tone={t.unrealized >= 0 ? "up" : "down"} />
                      <StatCard label="Realised P&L" value={formatMoney(t.realized, currency, true)} tone={t.realized >= 0 ? "up" : "down"} />
                    </div>
                  );
                })
              )}

              <section className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
                <p className="border-b border-[#1d1d1d] px-5 py-3 font-semibold">Positions</p>
                {state.status === "ready" && open.length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-[#888]">No open positions. Place a buy order to start.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="border-b border-[#1d1d1d] bg-[#0f0f0f] text-xs text-[#888]">
                      <tr>
                        <th scope="col" className="px-4 py-3 text-left font-medium">Holding</th>
                        <th scope="col" className="px-3 py-3 text-right font-medium">Qty</th>
                        <th scope="col" className="hidden px-3 py-3 text-right font-medium sm:table-cell">Avg cost</th>
                        <th scope="col" className="px-3 py-3 text-right font-medium">Value</th>
                        <th scope="col" className="px-4 py-3 text-right font-medium">P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {open.map((p) => {
                        const v = valuePosition(p, prices[priceKey(p)] ?? null);
                        return (
                          <tr key={`${p.assetType}|${p.symbol}`} className="border-b border-[#1b1b1b] last:border-b-0">
                            <td className="px-4 py-3">
                              <Link
                                href={p.assetType === "crypto" ? `/asset/crypto/${p.symbol}` : `/stock/${encodeURIComponent(p.symbol)}`}
                                className="flex items-center gap-2.5 hover:text-[#22c55e]"
                              >
                                <StockAvatar symbol={p.symbol} size={28} />
                                <span className="font-semibold">{p.symbol}</span>
                              </Link>
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">{p.quantity}</td>
                            <td className="hidden px-3 py-3 text-right tabular-nums sm:table-cell">{formatMoney(p.averageCost, p.currency)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{v.marketValue === null ? "—" : formatMoney(v.marketValue, p.currency)}</td>
                            <td className={`px-4 py-3 text-right tabular-nums ${toneClass(v.unrealizedPnl)}`}>
                              {v.unrealizedPnl === null ? "—" : `${formatMoney(v.unrealizedPnl, p.currency, true)}${v.unrealizedPct !== null ? ` (${v.unrealizedPct.toFixed(2)}%)` : ""}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
                <p className="border-b border-[#1d1d1d] px-5 py-3 font-semibold">Trade history</p>
                {state.status === "ready" && state.account.trades.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-[#888]">No trades yet.</p>
                ) : (
                  <ul>
                    {(state.status === "ready" ? state.account.trades : []).slice(0, 50).map((t) => (
                      <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#1b1b1b] px-5 py-2.5 text-sm last:border-b-0">
                        <span className={`w-10 font-semibold ${t.side === "buy" ? "text-[#4ade80]" : "text-[#f87171]"}`}>{t.side === "buy" ? "BUY" : "SELL"}</span>
                        <span className="font-semibold">{t.symbol}</span>
                        <span className="tabular-nums text-[#ccc]">
                          {t.quantity} × {formatMoney(t.price, t.currency)}
                        </span>
                        <span className="ml-auto text-xs text-[#777]">
                          {new Date(t.executedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        )}
      </PageShell>
    </AuthGuard>
  );
}
