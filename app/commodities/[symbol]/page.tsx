"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import PriceChart from "@/components/Charts/PriceChart";
import { ChangeText, FreshnessBadge, commodityHref } from "@/components/Markets/CommoditiesBoard";
import { EmptyState, PageShell, secondaryButtonClass } from "@/components/ui/Page";
import { formatValue } from "@/lib/charts/format";
import { findCommodity } from "@/lib/data/commodities";
import {
  contractMonth,
  formatExpiry,
  formatLots,
  formatTradeTime,
  lotLabel,
  quoteUnitLabel,
} from "@/lib/markets/commodities";
import type { CommodityDetail } from "@/lib/services/commodities";

/**
 * One MCX commodity: every open contract from Upstox, the chosen contract's
 * quote, chart and specification. /commodities/CRUDEOIL?expiry=2026-11-19;
 * without ?expiry the nearest contract is shown.
 */

type State =
  | { status: "loading" }
  | { status: "error"; message: string; notFound: boolean }
  | { status: "ready"; detail: CommodityDetail };

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="border-b border-[#1b1b1b] px-4 py-3 sm:px-5">
      <dt className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#777]">{label}</dt>
      <dd className="mt-1 text-sm tabular-nums text-[#e5e5e5]">{value ?? "—"}</dd>
    </div>
  );
}

function CommodityView() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();

  const symbol = decodeURIComponent(String(params.symbol ?? "")).toUpperCase();
  const requested = search.get("expiry");
  const known = findCommodity(symbol);

  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!known) return;
    let cancelled = false;

    fetch(`/api/commodities?symbol=${encodeURIComponent(symbol)}`)
      .then(async (response) => ({ status: response.status, data: await response.json() }))
      .then(({ status, data }) => {
        if (cancelled) return;
        setState(
          data?.success
            ? { status: "ready", detail: data as CommodityDetail }
            : { status: "error", message: data?.error ?? "Commodity data couldn't be loaded.", notFound: status === 404 }
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "Commodity data couldn't be loaded.", notFound: false });
      });

    return () => {
      cancelled = true;
    };
  }, [symbol, known, attempt]);

  const back = (
    <Link href="/commodities" className="mb-4 inline-block text-sm text-[#888] hover:text-white">
      ← All commodities
    </Link>
  );

  if (!known) {
    return (
      <>
        {back}
        <EmptyState icon="🛢️" title="Unknown commodity" description={`StockSphere doesn't list "${symbol}". Pick one from the Commodities page.`} />
      </>
    );
  }

  if (state.status === "loading") {
    return (
      <>
        {back}
        <div className="h-24 animate-pulse rounded-2xl bg-[#111]" aria-busy="true" />
        <div className="mt-4 h-96 animate-pulse rounded-2xl bg-[#111]" />
      </>
    );
  }

  if (state.status === "error") {
    return (
      <>
        {back}
        <div role="alert" className="rounded-2xl border border-[#222] bg-[#111] px-6 py-12 text-center">
          <p className="font-semibold">{state.notFound ? `No open ${known.name} contracts` : `${known.name} data is unavailable`}</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-[#888]">{state.message}</p>
          {!state.notFound && (
            <button
              type="button"
              onClick={() => {
                setState({ status: "loading" });
                setAttempt((n) => n + 1);
              }}
              className={`${secondaryButtonClass} mt-4`}
            >
              Try again
            </button>
          )}
        </div>
      </>
    );
  }

  const { product, contracts } = state.detail;
  const match = contracts.find((entry) => entry.contract.expiry === requested);
  const selected = match ?? contracts[0];
  const { contract, quote } = selected;
  const unit = quoteUnitLabel(product.quoteUnit);
  const lot = lotLabel(product.quoteUnit, contract.qtyMultiplier);
  const money = (value: number | null | undefined) => (value == null ? null : formatValue(value, "currency", "INR"));

  return (
    <>
      {back}

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[26px] font-bold tracking-tight">
            {product.name} <span className="text-[#888]">{contractMonth(contract.expiry)} FUT</span>
          </h1>
          <span className="rounded-md border border-[#2a2a2a] px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#999]">
            {product.exchange} · Futures
          </span>
        </div>
        <p className="mt-0.5 text-sm text-[#888]">
          {contract.tradingSymbol} · Expires {formatExpiry(contract.expiry)}
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-1">
          <p className="text-3xl font-semibold tabular-nums">
            {quote?.price != null ? money(quote.price) : <span className="text-lg text-[#777]">Price unavailable</span>}
            <span className="ml-1.5 text-sm font-normal text-[#777]">{unit}</span>
          </p>
          <p className="pb-1 text-sm">
            <ChangeText quote={quote} /> <span className="text-[#666]">1D</span>
          </p>
          <p className="pb-1">
            <FreshnessBadge quote={quote} />
          </p>
        </div>
      </header>

      {requested && !match && (
        <p className="mb-4 rounded-xl border border-[#2a2a2a] bg-[#151515] px-4 py-3 text-sm text-[#888]">
          No open contract expires on {formatExpiry(requested)}, so the nearest one is shown.
        </p>
      )}

      {contracts.length > 1 && (
        <div role="group" aria-label="Contract expiry" className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {contracts.map(({ contract: option }) => (
            <button
              key={option.instrumentKey}
              type="button"
              aria-pressed={option.instrumentKey === contract.instrumentKey}
              onClick={() => router.replace(commodityHref(product.symbol, option.expiry), { scroll: false })}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium ${
                option.instrumentKey === contract.instrumentKey
                  ? "border-[#22c55e] bg-[#22c55e] text-black"
                  : "border-[#2a2a2a] bg-[#111] text-[#bbb] hover:text-white"
              }`}
            >
              {contractMonth(option.expiry)}
            </button>
          ))}
        </div>
      )}

      <PriceChart key={contract.instrumentKey} type="commodity" symbol={product.symbol} expiry={contract.expiry} />

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Contract details</h2>
        <dl className="grid grid-cols-2 overflow-hidden rounded-2xl border border-[#222] bg-[#111] sm:grid-cols-4">
          <Fact label="Exchange" value={`${product.exchange} (MCX_FO)`} />
          <Fact label="Trading symbol" value={contract.tradingSymbol} />
          <Fact label="Expiry" value={formatExpiry(contract.expiry)} />
          <Fact label="Price quoted" value={`₹ ${unit}`} />
          <Fact label="Lot size" value={lot ? `1 lot = ${lot}` : null} />
          <Fact label="Tick size" value={contract.tickSize !== null ? money(contract.tickSize) : null} />
          <Fact label="Open" value={money(quote?.open)} />
          <Fact label="High" value={money(quote?.high)} />
          <Fact label="Low" value={money(quote?.low)} />
          <Fact label="Previous close" value={money(quote?.previousClose)} />
          <Fact label="Volume" value={quote?.volume != null ? formatLots(quote.volume) : null} />
          <Fact label="Open interest" value={quote?.openInterest != null ? formatLots(quote.openInterest) : null} />
          <Fact label="Last trade" value={formatTradeTime(quote?.lastTradeTime ?? null)} />
          <Fact label="Instrument key" value={contract.instrumentKey} />
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">All open {product.name} contracts</h2>
        <ul className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
          {contracts.map((entry) => (
            <li key={entry.contract.instrumentKey} className="border-b border-[#1b1b1b] last:border-b-0">
              <Link
                href={commodityHref(product.symbol, entry.contract.expiry)}
                replace
                scroll={false}
                aria-current={entry.contract.instrumentKey === contract.instrumentKey ? "true" : undefined}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-3 text-sm hover:bg-[#151515] sm:grid-cols-4 sm:px-5 ${
                  entry.contract.instrumentKey === contract.instrumentKey ? "bg-[#141414]" : ""
                }`}
              >
                <span>
                  <span className="block font-medium">{contractMonth(entry.contract.expiry)} FUT</span>
                  <span className="block text-xs text-[#777]">Exp {formatExpiry(entry.contract.expiry)}</span>
                </span>
                <span className="text-right tabular-nums sm:text-left">
                  {entry.quote?.price != null ? money(entry.quote.price) : <span className="text-xs text-[#777]">No trades</span>}
                </span>
                <span className="text-xs sm:text-sm">
                  <ChangeText quote={entry.quote} />
                </span>
                <span className="text-right text-xs tabular-nums text-[#ccc] sm:text-sm">
                  {entry.quote?.volume != null ? formatLots(entry.quote.volume) : "—"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-8 text-[11px] leading-relaxed text-[#666]">
        Market data from Upstox (MCX). &ldquo;Live&rdquo; means a trade in the last 10 minutes; otherwise the last traded price is
        shown with its time. Volume and open interest are in lots. For information only — not investment advice.
      </p>
    </>
  );
}

export default function CommodityPage() {
  return (
    <PageShell>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-[#111]" />}>
        <CommodityView />
      </Suspense>
    </PageShell>
  );
}
