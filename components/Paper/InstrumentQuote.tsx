"use client";

import { useEffect, useState } from "react";

import { StockAvatar } from "@/components/Markets/StockBits";
import { formatMoney } from "@/lib/client/useQuotes";
import type { PaperAssetType, PaperCurrency } from "@/lib/paper/ledger";
import { exchangeLabel, quoteStatus, type QuoteStatus } from "@/lib/paper/ticket";

/**
 * The selected instrument's latest price, from the same 1-day history the
 * chart draws (so the two never disagree), refreshed every minute. Nothing is
 * invented: no history means the price is shown as unavailable.
 */

export type Instrument = { assetType: PaperAssetType; symbol: string; name: string };

export type InstrumentQuote = {
  status: "loading" | "ready" | "error";
  name: string | null;
  price: number | null;
  change: number | null;
  changePct: number | null;
  currency: PaperCurrency | null;
  /** When the latest price traded (epoch ms). */
  time: number | null;
  freshness: QuoteStatus;
  source: string | null;
};

const EMPTY: InstrumentQuote = {
  status: "loading",
  name: null,
  price: null,
  change: null,
  changePct: null,
  currency: null,
  time: null,
  freshness: "unavailable",
  source: null,
};

const REFRESH_MS = 60_000;

export function useInstrumentQuote(instrument: Instrument | null): InstrumentQuote {
  const key = instrument ? `${instrument.assetType}|${instrument.symbol}` : "";
  const [state, setState] = useState<InstrumentQuote & { key: string }>({ ...EMPTY, key: "" });

  useEffect(() => {
    if (!key) return;
    const [type, symbol] = key.split("|") as [PaperAssetType, string];
    let cancelled = false;

    async function load() {
      try {
        const params = new URLSearchParams({ type, symbol, range: "1d", vs: "INR" });
        const data = await (await fetch(`/api/history?${params.toString()}`)).json();
        if (cancelled) return;
        if (!data?.success) {
          setState((previous) => (previous.key === key && previous.price !== null ? previous : { ...EMPTY, key, status: "error" }));
          return;
        }
        const candles: { t: number; c: number }[] = data.candles ?? [];
        const last = candles.at(-1) ?? null;
        const price = last && last.c > 0 ? last.c : null;
        const previousClose: number | null = typeof data.previousClose === "number" && data.previousClose > 0 ? data.previousClose : null;
        const change = price !== null && previousClose !== null ? price - previousClose : null;
        const currency: PaperCurrency | null = data.currency === "INR" || data.currency === "USD" ? data.currency : null;
        setState({
          key,
          status: "ready",
          name: data.name ?? null,
          price,
          change,
          changePct: change !== null && previousClose ? (change / previousClose) * 100 : null,
          currency,
          time: price !== null ? last!.t : null,
          freshness: quoteStatus({
            assetType: type,
            now: Date.now(),
            lastTime: price !== null ? last!.t : null,
            sessionStart: data.sessionStart ?? null,
            sessionEnd: data.sessionEnd ?? null,
          }),
          source: data.source ?? null,
        });
      } catch {
        // A failed refresh keeps the last good price; its time shows how old it is.
        if (!cancelled) setState((previous) => (previous.key === key && previous.price !== null ? previous : { ...EMPTY, key, status: "error" }));
      }
    }

    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [key]);

  if (!key) return { ...EMPTY, status: "error" };
  return state.key === key ? state : EMPTY;
}

const STATUS: Record<QuoteStatus, { label: string; className: string }> = {
  open: { label: "Market open", className: "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#4ade80]" },
  delayed: { label: "Delayed", className: "border-[#eab308]/40 bg-[#eab308]/10 text-[#facc15]" },
  closed: { label: "Market closed", className: "border-[#3a3a3a] bg-[#1a1a1a] text-[#aaa]" },
  unavailable: { label: "Price unavailable", className: "border-[#ef4444]/40 bg-[#ef4444]/10 text-[#f87171]" },
};

export function timeLabel(time: number, currency: PaperCurrency | null) {
  return new Date(time).toLocaleString(currency === "USD" ? "en-US" : "en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function QuoteBadge({ status }: { status: QuoteStatus }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.className}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

export default function InstrumentHeader({ instrument, quote }: { instrument: Instrument; quote: InstrumentQuote }) {
  const name = quote.name ?? instrument.name;
  const up = (quote.change ?? 0) >= 0;
  const exchange = exchangeLabel(instrument.assetType, instrument.symbol);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <StockAvatar symbol={instrument.symbol} size={48} type={instrument.assetType} />
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold leading-tight sm:text-xl" title={name}>
            {name}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#888]">
            <span className="font-semibold text-[#ccc]">{instrument.symbol.replace(/\.(NS|BO)$/, "")}</span>
            <span aria-hidden="true">·</span>
            <span>{exchange}</span>
            {instrument.assetType === "etf" && (
              <>
                <span aria-hidden="true">·</span>
                <span>ETF</span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="min-w-0 sm:text-right" aria-live="polite">
        {quote.status === "loading" ? (
          <div className="space-y-2 sm:flex sm:flex-col sm:items-end">
            <div className="h-8 w-36 animate-pulse rounded bg-[#1a1a1a]" />
            <div className="h-4 w-28 animate-pulse rounded bg-[#181818]" />
          </div>
        ) : quote.price === null || quote.currency === null ? (
          <div className="sm:flex sm:flex-col sm:items-end">
            <QuoteBadge status="unavailable" />
            <p className="mt-1.5 text-xs text-[#888]">No recent price for this instrument right now.</p>
          </div>
        ) : (
          <>
            <p className="break-words text-[28px] font-semibold tabular-nums leading-tight tracking-tight">{formatMoney(quote.price, quote.currency)}</p>
            <p className={`mt-0.5 text-sm font-medium tabular-nums ${up ? "text-[#00b386]" : "text-[#eb5b3c]"}`}>
              {quote.change !== null
                ? `${up ? "+" : "−"}${formatMoney(Math.abs(quote.change), quote.currency)}${quote.changePct !== null ? ` (${Math.abs(quote.changePct).toFixed(2)}%)` : ""}`
                : "Change unavailable"}
              <span className="ml-1.5 font-normal text-[#777]">today</span>
            </p>
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-[#777] sm:justify-end">
              <QuoteBadge status={quote.freshness} />
              {quote.time !== null && (
                <span>
                  {quote.freshness === "closed" ? "Last price" : "Updated"} {timeLabel(quote.time, quote.currency)}
                </span>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
