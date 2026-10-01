"use client";

import { useState, useEffect } from "react";
import AuthGuard from "@/components/AuthGuard";
import {
  addHolding,
  getPortfolio,
  removeHolding,
} from "@/lib/portfolio";

/** A live quote reduced to what the portfolio renders: a price and its currency. */
type LiveQuote = {
  price: number;
  currency: string;
};

/**
 * The symbol for a currency, taken from the quote the endpoint returned.
 *
 * It is never inferred from the shape of the ticker: an Indian quote reaches
 * this page from Upstox announcing "INR", and a global one from Twelve Data or
 * Yahoo announcing "USD". Alpha Vantage's adapter carries no currency field, so
 * a global quote that fell through to it arrives without one — on this app's
 * global path an unannounced currency is USD, which is the fallback here.
 */
function currencySymbol(currency: string | undefined): string {
  return String(currency ?? "").toUpperCase() === "INR" ? "₹" : "$";
}

/** The portfolio's totals for one currency, never mixed with another. */
type CurrencyTotal = {
  currency: string;
  value: number;
  cost: number;
  pnl: number;
};

/**
 * Render an amount in the currency its quotes reported, to two decimals — the
 * precision the per-holding Profit/Loss line already uses.
 *
 * A negative amount carries its sign in front of the currency symbol, which is
 * where a loss is read from; the digits are formatted from the magnitude so the
 * grouping is the same either way.
 */
function formatMoney(currency: string, amount: number): string {
  return (
    (amount < 0 ? "-" : "") +
    currencySymbol(currency) +
    Math.abs(amount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/**
 * A shimmer placeholder for a figure that has not arrived yet.
 *
 * This is the loading slot's appearance only: the condition that decides when
 * the slot is in its loading state is untouched. role/aria-label are here so the
 * placeholder is announced rather than being a purely visual cue.
 */
function Skeleton({ width }: { width: string }) {
  return (
    <span
      className="pf-skeleton"
      style={{ width }}
      role="status"
      aria-label="Loading"
    />
  );
}

/** Muted marker for a figure no quote could be obtained for. */
function UnavailableTag() {
  return <span className="pf-unavailable">Unavailable</span>;
}

/**
 * Portfolio styling.
 *
 * Scoped to pf- classes and kept in one block because these are the states that
 * cannot be written inline: hover, focus-visible, the shimmer keyframes, the
 * reduced-motion opt-out and the two breakpoints. The colours are the ones the
 * rest of the app already uses — #111 surfaces on #222 borders, #888 muted text,
 * #22c55e for the primary action.
 */
const PF_STYLES = `
.pf-root {
  background: #000;
  color: #fff;
  /* The navbar is in the root layout and renders 65px: 64px from the h-16 class
     plus its own 1px bottom border. Subtracting 64 leaves 1px over. */
  min-height: calc(100vh - 65px);
  padding: 24px 16px 72px;
}
.pf-shell {
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
}
.pf-title {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.pf-summary {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  margin: 22px 0 28px;
}
.pf-card {
  background: #111;
  border: 1px solid #222;
  border-radius: 16px;
  padding: 18px 20px;
  transition: border-color 150ms ease;
}
.pf-card:hover { border-color: #2e2e2e; }
.pf-card-label {
  margin: 0 0 10px;
  color: #888;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}
.pf-card-value {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.pf-amount { display: block; }
.pf-up { color: #4ade80; }
.pf-down { color: #f87171; }

.pf-btn {
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 11px 18px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  transition: background 150ms ease, transform 150ms ease;
}
/* Black on green-500, the app's primary idiom: around 13:1 against the green,
   where white would be under 2:1. */
.pf-btn-primary { background: #22c55e; color: #000; }
.pf-btn-primary:hover { background: #1ea34d; }
.pf-btn:active { transform: translateY(1px); }
.pf-btn:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 2px;
}

.pf-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 340px;
  margin-top: 20px;
  padding: 18px;
  background: #111;
  border: 1px solid #222;
  border-radius: 16px;
}
.pf-input {
  box-sizing: border-box;
  width: 100%;
  padding: 11px 13px;
  background: #0b0b0b;
  border: 1px solid #262626;
  border-radius: 10px;
  color: #fff;
  font-family: inherit;
  font-size: 14px;
  transition: border-color 150ms ease, background 150ms ease;
}
.pf-input::placeholder { color: #6b6b6b; }
.pf-input:hover { border-color: #333; }
.pf-input:focus {
  background: #000;
  border-color: #22c55e;
  outline: 2px solid rgba(34, 197, 94, 0.35);
  outline-offset: 1px;
}

.pf-holdings {
  display: grid;
  gap: 14px;
  margin-top: 26px;
}
.pf-holding {
  background: #111;
  border: 1px solid #222;
  border-radius: 16px;
  padding: 16px 18px;
  transition: border-color 150ms ease, transform 150ms ease;
}
.pf-holding:hover {
  border-color: #2e2e2e;
  transform: translateY(-1px);
}
.pf-holding-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.pf-symbol {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.01em;
  overflow-wrap: anywhere;
}
.pf-remove {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  color: #999;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
}
.pf-remove:hover {
  background: #2a1414;
  border-color: #4a2020;
  color: #f87171;
}
.pf-remove:focus-visible {
  outline: 2px solid #f87171;
  outline-offset: 2px;
}

.pf-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 16px;
  margin: 0;
}
.pf-metric { min-width: 0; }
.pf-metric dt {
  margin-bottom: 5px;
  color: #777;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.pf-metric dd {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.pf-metric-primary dd {
  font-size: 17px;
  font-weight: 700;
}

.pf-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.pf-chip.pf-up {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.3);
}
.pf-chip.pf-down {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
}

.pf-unavailable {
  display: inline-block;
  padding: 3px 10px;
  background: #171717;
  border: 1px solid #262626;
  border-radius: 999px;
  color: #8a8a8a;
  font-size: 13px;
  font-weight: 500;
}

.pf-skeleton {
  display: inline-block;
  height: 0.85em;
  border-radius: 6px;
  background: linear-gradient(90deg, #1b1b1b 25%, #2a2a2a 37%, #1b1b1b 63%);
  background-size: 400% 100%;
  animation: pf-shimmer 1.4s ease infinite;
  vertical-align: middle;
}
@keyframes pf-shimmer {
  from { background-position: 100% 0; }
  to { background-position: 0 0; }
}

@media (prefers-reduced-motion: reduce) {
  .pf-skeleton {
    animation: none;
    background: #202020;
  }
  .pf-card, .pf-holding, .pf-btn, .pf-input, .pf-remove {
    transition: none;
  }
  .pf-holding:hover { transform: none; }
}

@media (min-width: 700px) {
  .pf-root { padding: 40px 32px 96px; }
  .pf-title { font-size: 32px; }
  .pf-card { padding: 22px 24px; }
  .pf-card-value { font-size: 27px; }
  .pf-summary { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .pf-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .pf-holding { padding: 20px 22px; }
}
`;

export default function PortfolioPage() {
  const [showForm, setShowForm] = useState(false);
  const [symbol, setSymbol] = useState("");
const [quantity, setQuantity] = useState("");
const [buyPrice, setBuyPrice] = useState("");
const [holdings, setHoldings] = useState<any[]>([]);
// Live quotes, keyed by upper-case symbol, fetched from
// /api/market?symbol= once the holdings are known.
//
// This table used to hold five hardcoded prices (and TCS before them) — stale
// market data presented as a current quote with nothing behind it. It then
// became an empty object, which was honest but told the user nothing. It is now
// filled from the quote endpoint, one request per unique holding symbol.
//
// Each entry keeps the quote's own currency next to its price. The endpoint has
// always said which currency a quote is in — the page used to throw that away
// and print ₹ over it, Indian or not.
//
// A symbol whose quote cannot be obtained maps to null and renders as
// "Unavailable". It is never replaced by a stale number and never by zero, so
// nothing below can compute a value out of a price nobody could source.
const [quotes, setQuotes] = useState<Record<string, LiveQuote | null>>({});
const [quotesLoading, setQuotesLoading] = useState(false);

function currentQuote(symbol: string): LiveQuote | null {
  return quotes[String(symbol).toUpperCase()] ?? null;
}

const unpricedCount = holdings.filter(
  (holding) => currentQuote(holding.symbol) === null
).length;

// Portfolio totals, grouped by the currency the quotes reported.
//
// Adding rupees to dollars produces a number that means nothing: 20324 INR +
// 992.79 USD is not 21316.79 of anything. So the totals are accumulated per
// currency and are never summed across currencies, and no exchange rate is
// invented to merge them.
//
// A holding nobody could price has no currency and no current value, so it
// lands in no group. That is only safe because unpricedCount below keeps both
// cards on "Unavailable" while any holding is unpriced — a partial group is
// never shown as though it were the whole portfolio.
const currencyTotals = (() => {
  const totals = new Map<string, CurrencyTotal>();

  for (const holding of holdings) {
    const quote = currentQuote(holding.symbol);

    if (quote === null) continue;

    const quantity = Number(holding.quantity);
    const value = quote.price * quantity;
    const cost = Number(holding.buy_price) * quantity;

    const running = totals.get(quote.currency) ?? {
      currency: quote.currency,
      value: 0,
      cost: 0,
      pnl: 0,
    };

    running.value += value;
    running.cost += cost;

    totals.set(quote.currency, running);
  }

  // P/L is the group's own two totals subtracted, exactly as the single-currency
  // version computed it, rather than each holding's P/L accumulated — the two
  // differ in floating point and this keeps the former.
  return Array.from(totals.values()).map((total) => ({
    ...total,
    pnl: total.value - total.cost,
  }));
})();
const saveHolding = async () => {
  await addHolding(
    symbol.toUpperCase(),
    Number(quantity),
    Number(buyPrice)
  );

  const updated = await getPortfolio();

  setHoldings(updated);

  alert("Holding Added");

  setSymbol("");
  setQuantity("");
  setBuyPrice("");

  setShowForm(false);
};
useEffect(() => {
  const fetchPortfolio = async () => {
    const data = await getPortfolio();
    setHoldings(data);
  };

  fetchPortfolio();
}, []);

useEffect(() => {
  // Unique symbols only: a portfolio holding the same stock twice must not ask
  // the quote endpoint for it twice.
  const symbols = Array.from(
    new Set(
      holdings
        .map((holding) =>
          String(holding.symbol ?? "")
            .trim()
            .toUpperCase()
        )
        .filter((holdingSymbol) => holdingSymbol.length > 0)
    )
  );

  // The holdings can change while these requests are in flight (a holding is
  // added or removed); a stale response must not overwrite the newer one.
  let cancelled = false;

  // Every state update happens inside this async function rather than in the
  // effect body: setState called synchronously in an effect cascades renders
  // (react-hooks/set-state-in-effect), and these updates are all consequences
  // of the fetch anyway.
  const fetchQuotes = async () => {
    if (symbols.length === 0) {
      if (cancelled) return;

      setQuotes({});
      setQuotesLoading(false);

      return;
    }

    setQuotesLoading(true);

    const results = await Promise.all(
      symbols.map(async (holdingSymbol) => {
        try {
          const response = await fetch(
            `/api/market?symbol=${encodeURIComponent(holdingSymbol)}`
          );

          if (!response.ok) {
            return [holdingSymbol, null] as const;
          }

          const data = await response.json();
          const quote = data?.quote;
          const price = quote?.price;

          // Only a positive finite number counts as a price. A zero or a
          // malformed value is no quote at all — treating either as a price
          // would put a fabricated figure into the totals below.
          //
          // The currency is carried through with the price rather than guessed
          // later, so a row can only ever be labelled with the currency the
          // endpoint actually reported for it.
          return [
            holdingSymbol,
            typeof price === "number" &&
            Number.isFinite(price) &&
            price > 0
              ? { price, currency: String(quote?.currency ?? "") }
              : null,
          ] as const;
        } catch {
          return [holdingSymbol, null] as const;
        }
      })
    );

    if (cancelled) return;

    setQuotes(Object.fromEntries(results));
    setQuotesLoading(false);
  };

  fetchQuotes();

  return () => {
    cancelled = true;
  };
}, [holdings]);

  return (
    <AuthGuard>
    <div className="pf-root">
      <style>{PF_STYLES}</style>

      <div className="pf-shell">
      <h1 className="pf-title">💼 My Portfolio</h1>

      <section className="pf-summary" aria-label="Portfolio summary">
  <div className="pf-card">
    <h3 className="pf-card-label">Portfolio Value</h3>
    <h2 className="pf-card-value">
      {quotesLoading ? (
        <Skeleton width="130px" />
      ) : unpricedCount > 0 ? (
        <UnavailableTag />
      ) : (
        // One currency prints one line; several print one line each. Never a
        // combined figure — there is no rate here and none is assumed.
        currencyTotals.map((total) => (
          <span key={total.currency} className="pf-amount">
            {formatMoney(total.currency, total.value)}
          </span>
        ))
      )}
    </h2>
  </div>

  <div className="pf-card">
    <h3 className="pf-card-label">Total P/L</h3>
    <h2 className="pf-card-value">
      {quotesLoading ? (
        <Skeleton width="100px" />
      ) : unpricedCount > 0 ? (
        // Nothing to report: muted, like the grey this heading used to carry,
        // and each currency's line keeps its own colour once there is one,
        // since two currencies can disagree on sign.
        <UnavailableTag />
      ) : (
        currencyTotals.map((total) => (
          <span
            key={total.currency}
            className={
              "pf-amount " + (total.pnl >= 0 ? "pf-up" : "pf-down")
            }
          >
            {formatMoney(total.currency, total.pnl)}
          </span>
        ))
      )}
    </h2>
  </div>

  <div className="pf-card">
    <h3 className="pf-card-label">Holdings</h3>
    <h2 className="pf-card-value">{holdings.length}</h2>
  </div>
</section>

      <button
        className="pf-btn pf-btn-primary"
        onClick={() => setShowForm(!showForm)}
      >
        ➕ Add Holding
      </button>

      {showForm && (
        <div className="pf-form">
          <input
  className="pf-input"
  placeholder="Stock Symbol"
  value={symbol}
  onChange={(e) => setSymbol(e.target.value)}
/>

          <input
  className="pf-input"
  placeholder="Quantity"
  value={quantity}
  onChange={(e) => setQuantity(e.target.value)}
/>

    <input
  className="pf-input"
  placeholder="Buy Price"
  value={buyPrice}
  onChange={(e) => setBuyPrice(e.target.value)}
/>

          <button
  className="pf-btn pf-btn-primary"
  onClick={saveHolding}
          >
            Save Holding
          </button>
        </div>
      )}

      <div className="pf-holdings">
  {holdings.map((holding) => {
    const quote = currentQuote(holding.symbol);

    // The currency comes from the quote itself. Only a holding with no quote at
    // all falls back to INR, which is the symbol this page put on every figure
    // before — including a cost basis, which is in the same currency as the
    // quote by construction, so it is labelled with the same unit.
    const currency = quote === null ? "INR" : quote.currency;

    const gain =
      quote !== null && quote.price - Number(holding.buy_price) >= 0;

    return (
  <article
    key={holding.id}
    className="pf-holding"
>
      <div className="pf-holding-head">
  <h3 className="pf-symbol">{holding.symbol}</h3>

  <button
  className="pf-remove"
  aria-label={`Remove ${holding.symbol}`}
  onClick={async () => {
  await removeHolding(holding.id);

  const updated = await getPortfolio();

  setHoldings(updated);
}}
>
  ✕
</button>
</div>

<dl className="pf-metrics">
  <div className="pf-metric">
    <dt>Quantity</dt>
    <dd>{holding.quantity}</dd>
  </div>

  <div className="pf-metric">
    <dt>Buy Price</dt>
    <dd>{formatMoney(currency, Number(holding.buy_price))}</dd>
  </div>

  <div className="pf-metric">
    <dt>Investment Value</dt>
    <dd>
      {formatMoney(
        currency,
        Number(holding.quantity) * Number(holding.buy_price)
      )}
    </dd>
  </div>
  <div className="pf-metric">
    <dt>Current Price</dt>
    <dd>
      {quotesLoading ? (
        <Skeleton width="70px" />
      ) : quote === null ? (
        <UnavailableTag />
      ) : (
        formatMoney(currency, quote.price)
      )}
    </dd>
  </div>

  <div className="pf-metric pf-metric-primary">
    <dt>Current Value</dt>
    <dd>
      {quotesLoading ? (
        <Skeleton width="90px" />
      ) : quote === null ? (
        <UnavailableTag />
      ) : (
        formatMoney(currency, quote.price * Number(holding.quantity))
      )}
    </dd>
  </div>

  <div className="pf-metric pf-metric-primary">
    <dt>Profit/Loss</dt>
    <dd>
      {quotesLoading ? (
        <Skeleton width="80px" />
      ) : quote === null ? (
        // Nothing could be priced, so nothing is coloured either way.
        <UnavailableTag />
      ) : (
        <span className={"pf-chip " + (gain ? "pf-up" : "pf-down")}>
          {gain ? "▲" : "▼"}{" "}
          {formatMoney(
            currency,
            (quote.price - Number(holding.buy_price)) *
              Number(holding.quantity)
          )}
        </span>
      )}
    </dd>
  </div>
</dl>
    </article>
    );
  })}
</div>
      </div>
    </div>
    </AuthGuard>
  );
}