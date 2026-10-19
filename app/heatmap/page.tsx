"use client";

import Link from "next/link";

import {
  EmptyState,
  PageHeader,
  PageShell,
} from "@/components/ui/Page";
import {
  formatQuotePrice,
  formatSignedPercent,
  useMarketOverview,
  type OverviewQuote,
} from "@/lib/client/useMarketOverview";

/**
 * Market Heatmap.
 *
 * The tiles used to be three hardcoded strings ("AAPL +1.2%" …). They now show
 * the live /api/market overview, coloured by the day's move: the stronger the
 * move, the deeper the colour, capped at ±3% so one outlier cannot wash out
 * the rest.
 */
function tileStyle(changePercent: number | null) {
  if (changePercent === null) {
    return { background: "#111", borderColor: "#222" };
  }

  const strength = Math.min(Math.abs(changePercent) / 3, 1);
  const rgb = changePercent >= 0 ? "34, 197, 94" : "239, 68, 68";

  return {
    background: `rgba(${rgb}, ${0.08 + strength * 0.32})`,
    borderColor: `rgba(${rgb}, ${0.25 + strength * 0.4})`,
  };
}

function Tile({ quote }: { quote: OverviewQuote }) {
  return (
    <Link
      href={`/stock/${quote.symbol}`}
      style={tileStyle(quote.changePercent)}
      className="flex min-h-[124px] flex-col justify-between rounded-2xl border p-4 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-5"
    >
      <div>
        <p className="text-lg font-bold tracking-tight">{quote.symbol}</p>
        <p className="truncate text-xs text-white/60">{quote.name}</p>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="text-xl font-semibold tabular-nums">
          {formatSignedPercent(quote.changePercent)}
        </span>
        <span className="text-xs tabular-nums text-white/70">
          {formatQuotePrice(quote.price, quote.currency)}
        </span>
      </div>
    </Link>
  );
}

export default function HeatmapPage() {
  const overview = useMarketOverview();

  return (
    <PageShell>
      <PageHeader
        eyebrow="Heatmap"
        title="Market heatmap"
        description="Today's moves for large caps in the US and India. Deeper colour means a bigger move."
      />

      {overview.status === "error" && (
        <EmptyState
          icon="📡"
          title="Market data is unavailable right now"
          description="Our data providers didn't respond. Please try again in a minute."
        />
      )}

      {overview.status === "loading" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="min-h-[124px] animate-pulse rounded-2xl border border-[#1f1f1f] bg-[#111]"
            />
          ))}
        </div>
      )}

      {overview.status === "ready" &&
        (["US", "India"] as const).map((market) => {
          const quotes = overview.quotes
            .filter((quote) => quote.market === market)
            .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));

          if (quotes.length === 0) return null;

          return (
            <section key={market} className="mb-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-[#888]">
                {market === "US" ? "United States" : "India · NSE"}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {quotes.map((quote) => (
                  <Tile key={quote.symbol} quote={quote} />
                ))}
              </div>
            </section>
          );
        })}
    </PageShell>
  );
}
