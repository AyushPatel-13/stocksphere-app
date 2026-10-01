"use client";

import { useEffect, useState } from "react";

type Props = {
  symbol: string;
  onRemove: () => void;
};

/**
 * Pre-existing hardcoded metadata, reproduced unchanged.
 *
 * It covers three symbols and nothing else; every other symbol — including all
 * of the Indian ones — falls through to the block below and shows the symbol as
 * its own name, "Unknown" as its sector and no exchange. That gap predates this
 * change and is left exactly as it was: filling it in would mean inventing
 * company data, and no endpoint this card is allowed to call returns it.
 */
const companyData: Record<
  string,
  {
    name: string;
    sector: string;
    exchange: string;
  }
> = {
  NVDA: {
    name: "NVIDIA Corporation",
    sector: "Technology",
    exchange: "NASDAQ",
  },
  AAPL: {
    name: "Apple Inc.",
    sector: "Technology",
    exchange: "NASDAQ",
  },
  MSFT: {
    name: "Microsoft Corporation",
    sector: "Technology",
    exchange: "NASDAQ",
  },
};

/** The quote's own currency. USD is what every card showed before. */
function currencySymbol(currency?: string) {
  return currency === "INR" ? "₹" : "$";
}

type Quote = {
  price: number;
  change?: number;
  changePercent?: number;
  currency?: string;
};

export default function WatchlistCard({
  symbol,
  onRemove,
}: Props) {
  const [quote, setQuote] = useState<Quote | null>(null);

  /**
   * A request that failed, or answered success:false. Distinct from quote being
   * null while the request is still in flight, so the card cannot sit on
   * "Loading" forever — the same reason the page keeps its own flag.
   */
  const [quoteFailed, setQuoteFailed] = useState(false);

  const info = companyData[symbol] ?? {
    name: symbol,
    sector: "Unknown",
    exchange: "-",
  };

  useEffect(() => {
  async function loadPrice() {
    try {
      const response = await fetch(
        `/api/market?symbol=${symbol}`
      );

      const data = await response.json();

      // This route answers { success, symbol, quote } — the price is on quote,
      // not at the top level. Reading data.price always produced undefined, and
      // the old `price !== null` test passed that undefined straight into
      // toFixed(), which threw during render. A missing quote is now an
      // unavailable card instead of a crash.
      //
      // The change and changePercent shown beside it come from that same
      // response, through the same single request.
      if (data?.quote?.price != null) {
        setQuote(data.quote);
      } else {
        setQuoteFailed(true);
      }
    } catch (err) {
      console.error(err);

      setQuoteFailed(true);
    }
  }

  loadPrice();
}, [symbol]);

  const changePercent = quote?.changePercent;

  const tone =
    changePercent == null
      ? null
      : changePercent > 0
      ? "up"
      : changePercent < 0
      ? "down"
      : "flat";

  const changeText =
    changePercent == null
      ? null
      : `${changePercent > 0 ? "+" : ""}${changePercent.toFixed(2)}%`;

  return (
    <article className="wl-card">
      {/* The symbol is spelled out below, so the monogram is decoration. */}
      <div className="wl-monogram" aria-hidden="true">
        {symbol[0]}
      </div>

      <h3 className="wl-name">{info.name}</h3>

      {/* The exchange is the placeholder "-" for every symbol the hardcoded map
          does not cover, so it is dropped rather than left dangling off a
          bullet. */}
      <p className="wl-meta">
        {symbol}
        {info.exchange !== "-" ? ` • ${info.exchange}` : ""}
      </p>

      {quote ? (
        <p className="wl-price">
          {currencySymbol(quote.currency)}
          {quote.price.toFixed(2)}
        </p>
      ) : quoteFailed ? (
        <p className="wl-price wl-price-missing">Unavailable</p>
      ) : (
        <p className="wl-price" role="status" aria-label="Loading price">
          <span className="wl-skeleton" aria-hidden="true" />
        </p>
      )}

      {/* Only when the quote actually carries a move. This replaces a hardcoded
          green "▲ Live Price Coming Soon" printed under the live price; the
          real change was in the response this card was already fetching. */}
      {tone && changeText ? (
        <p className={`wl-change wl-${tone}`}>{changeText}</p>
      ) : null}

      <p className="wl-sector">{info.sector}</p>

      <div className="wl-actions">
        <button
          className="wl-btn wl-btn-primary"
          onClick={() =>
            (window.location.href = `/stock/${symbol}`)
          }
        >
          Open Stock →
        </button>

        <button className="wl-btn wl-btn-remove" onClick={onRemove}>
          Remove
        </button>
      </div>
    </article>
  );
}
