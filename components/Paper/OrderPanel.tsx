"use client";

import { useState } from "react";

import { formatMoney } from "@/lib/client/useQuotes";
import { submitPaperOrder } from "@/lib/paper/client";
import type { PaperCurrency, PaperSide } from "@/lib/paper/ledger";
import { maxQuantity, reviewTicket } from "@/lib/paper/ticket";

import type { Instrument, InstrumentQuote } from "./InstrumentQuote";

/**
 * The order ticket. The engine fills market orders only, at the server's own
 * live price during market hours, so that is the only order type offered: no
 * limit, stop, intraday or delivery controls that wouldn't do anything.
 *
 * The estimate uses the price on screen; the fill price can differ slightly.
 * Cash, holdings and the per-order cap are checked here so a doomed order is
 * stopped early, and checked again by the server, which has the final say.
 */

type Message = { tone: "ok" | "error" | "info"; text: string };

const newRequestId = () => crypto.randomUUID();

const SIDE_STYLE: Record<PaperSide, { tab: string; button: string }> = {
  buy: {
    tab: "border-[#00b386] text-[#00d49e]",
    button: "bg-[#00b386] text-black hover:bg-[#00c895] focus-visible:ring-[#00b386]/60",
  },
  sell: {
    tab: "border-[#eb5b3c] text-[#ff7a5c]",
    button: "bg-[#eb5b3c] text-black hover:bg-[#ff6b4a] focus-visible:ring-[#eb5b3c]/60",
  },
};

export default function OrderPanel({
  instrument,
  quote,
  cash,
  held,
  onFilled,
}: {
  instrument: Instrument;
  quote: InstrumentQuote;
  /** Available virtual cash per currency; null while the account loads. */
  cash: Record<PaperCurrency, number> | null;
  /** Units of this instrument currently held. */
  held: number;
  onFilled: () => void;
}) {
  const [side, setSide] = useState<PaperSide>("buy");
  const [quantityText, setQuantityText] = useState("1");
  const [requestId, setRequestId] = useState(newRequestId);
  const [message, setMessage] = useState<Message | null>(null);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const isCrypto = instrument.assetType === "crypto";
  const currency = quote.currency;
  const available = currency && cash ? cash[currency] : null;
  const review = reviewTicket({ side, assetType: instrument.assetType, quantityText, price: quote.price, currency, cash: available, held });
  const max = maxQuantity({ side, assetType: instrument.assetType, price: quote.price, currency, cash: available, held });
  const ticker = instrument.symbol.replace(/\.(NS|BO)$/, "");
  const step = isCrypto ? 0.001 : 1;

  function changeQuantity(text: string) {
    setQuantityText(text);
    setTouched(true);
    setMessage(null);
    // A different order is a different attempt.
    setRequestId(newRequestId());
  }

  function nudge(direction: 1 | -1) {
    const current = Number(quantityText);
    const base = Number.isFinite(current) ? current : 0;
    const next = Math.max(step, Math.round((base + direction * step) * 1e8) / 1e8);
    changeQuantity(String(next));
  }

  function pickSide(next: PaperSide) {
    if (next === side) return;
    setSide(next);
    setMessage(null);
    setRequestId(newRequestId());
  }

  async function submit() {
    setTouched(true);
    if (review.problem || review.quantity === null) {
      setMessage({ tone: "error", text: review.problem ?? "Enter a quantity." });
      return;
    }
    setSaving(true);
    setMessage(null);
    const result = await submitPaperOrder({ requestId, assetType: instrument.assetType, symbol: instrument.symbol, side, quantity: review.quantity });
    setSaving(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.code === "NOT_CONFIGURED" ? "Paper trading is launching soon." : result.error });
      return;
    }
    setRequestId(newRequestId());
    const filled = formatMoney(result.price * review.quantity, result.currency);
    setMessage({
      tone: "ok",
      text: result.replayed
        ? `This order was already placed: ${side === "buy" ? "bought" : "sold"} ${review.quantity} ${ticker} at ${formatMoney(result.price, result.currency)}.`
        : `${side === "buy" ? "Bought" : "Sold"} ${review.quantity} ${ticker} at ${formatMoney(result.price, result.currency)} (${filled}).${
            result.cashAfter !== null ? ` Cash now ${formatMoney(result.cashAfter, result.currency)}.` : ""
          }`,
    });
    onFilled();
  }

  const showProblem = touched && review.problem && message?.tone !== "error";

  return (
    <form
      noValidate
      aria-label={`Paper order for ${ticker}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]"
    >
      <div className="grid grid-cols-2 border-b border-[#222]" role="group" aria-label="Order side">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            
            aria-pressed={side === s}
            onClick={() => pickSide(s)}
            className={`border-b-2 py-3 text-sm font-semibold transition-colors focus-visible:bg-[#1a1a1a] focus-visible:outline-none ${
              side === s ? SIDE_STYLE[s].tab : "border-transparent text-[#888] hover:bg-[#151515] hover:text-white"
            }`}
          >
            {s === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      <div className="space-y-4 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate font-semibold" title={instrument.name}>
            {ticker}
          </p>
          <p className="shrink-0 text-sm tabular-nums text-[#ccc]">
            {quote.price !== null && currency ? formatMoney(quote.price, currency) : quote.status === "loading" ? "…" : "Price unavailable"}
          </p>
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-[#888]">Order type</span>
          <div className="flex items-center justify-between rounded-xl border border-[#2a2a2a] bg-[#151515] px-3.5 py-2.5 text-sm">
            <span className="font-medium">Market</span>
            <span className="text-xs text-[#777]">Fills at the latest price</span>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label htmlFor="paper-qty" className="text-xs font-medium text-[#888]">
              Quantity {isCrypto ? "(units)" : "(shares)"}
            </label>
            {max !== null && (
              <button
                type="button"
                onClick={() => changeQuantity(String(max))}
                className="rounded text-xs font-medium text-[#22c55e] hover:text-[#4ade80] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/40"
              >
                Max {max}
              </button>
            )}
          </div>
          <div className="flex items-stretch overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] focus-within:border-[#22c55e]/70 focus-within:ring-2 focus-within:ring-[#22c55e]/25">
            <button
              type="button"
              onClick={() => nudge(-1)}
              aria-label="Decrease quantity"
              className="w-11 shrink-0 text-lg text-[#aaa] hover:bg-[#222] hover:text-white focus-visible:bg-[#222] focus-visible:outline-none"
            >
              −
            </button>
            <input
              id="paper-qty"
              value={quantityText}
              onChange={(event) => changeQuantity(event.target.value)}
              inputMode={isCrypto ? "decimal" : "numeric"}
              autoComplete="off"
              aria-invalid={Boolean(touched && review.problem)}
              aria-describedby="paper-qty-help"
              className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-center text-base tabular-nums text-white outline-none"
            />
            <button
              type="button"
              onClick={() => nudge(1)}
              aria-label="Increase quantity"
              className="w-11 shrink-0 text-lg text-[#aaa] hover:bg-[#222] hover:text-white focus-visible:bg-[#222] focus-visible:outline-none"
            >
              +
            </button>
          </div>
          <p id="paper-qty-help" className={`mt-1.5 min-h-[1rem] text-xs ${showProblem ? "text-[#f87171]" : "text-[#666]"}`}>
            {showProblem ? review.problem : isCrypto ? "Fractions allowed, up to 8 decimals." : "Whole shares only."}
          </p>
        </div>

        <dl className="space-y-2 rounded-xl border border-[#1f1f1f] bg-[#0d0d0d] p-3.5 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-[#888]">Est. order value</dt>
            <dd className="min-w-0 break-all text-right font-semibold tabular-nums">
              {review.value !== null && currency ? formatMoney(review.value, currency) : "—"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-[#888]">{side === "buy" ? "Available cash" : isCrypto ? "Units held" : "Shares held"}</dt>
            <dd className="min-w-0 break-all text-right tabular-nums text-[#ccc]">
              {side === "buy"
                ? available !== null && currency
                  ? formatMoney(available, currency)
                  : cash === null
                    ? "…"
                    : "—"
                : held}
            </dd>
          </div>
        </dl>

        {message && (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={`rounded-xl border px-3.5 py-2.5 text-sm ${
              message.tone === "error" ? "border-[#ef4444]/30 bg-[#ef4444]/10 text-[#fca5a5]" : "border-[#22c55e]/30 bg-[#22c55e]/10 text-[#86efac]"
            }`}
          >
            {message.text}
          </p>
        )}

        {quote.freshness === "closed" && !isCrypto && (
          <p className="text-xs text-[#aaa]">The market is closed. Orders fill only during market hours.</p>
        )}

        <button
          type="submit"
          disabled={saving}
          className={`w-full rounded-xl px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111] disabled:cursor-not-allowed disabled:opacity-60 ${SIDE_STYLE[side].button}`}
        >
          {saving ? "Placing order…" : `Place ${side === "buy" ? "buy" : "sell"} order`}
        </button>

        <p className="text-[11px] leading-relaxed text-[#666]">
          Virtual money only. Market orders fill at StockSphere&apos;s latest price, which may differ slightly from the estimate. Not investment advice.
        </p>
      </div>
    </form>
  );
}
