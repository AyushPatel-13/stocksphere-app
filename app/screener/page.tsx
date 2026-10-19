"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

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

type MarketFilter = "All" | OverviewQuote["market"];
type SortKey = "symbol" | "price" | "changePercent";

const FILTERS: MarketFilter[] = ["All", "US", "India"];

function compare(a: OverviewQuote, b: OverviewQuote, key: SortKey) {
  if (key === "symbol") return a.symbol.localeCompare(b.symbol);
  if (key === "price") return a.price - b.price;
  return (a.changePercent ?? -Infinity) - (b.changePercent ?? -Infinity);
}

type SortState = { key: SortKey; desc: boolean };

function SortHeader({
  label,
  k,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  k: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
      className={`px-4 py-3 font-medium ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-white ${active ? "text-white" : ""}`}
      >
        {label}
        <span aria-hidden="true" className="text-[9px]">
          {active ? (sort.desc ? "▼" : "▲") : ""}
        </span>
      </button>
    </th>
  );
}

export default function ScreenerPage() {
  const overview = useMarketOverview();
  const [market, setMarket] = useState<MarketFilter>("All");
  const [sort, setSort] = useState<SortState>({
    key: "changePercent",
    desc: true,
  });

  const rows = useMemo(() => {
    if (overview.status !== "ready") return [];
    return overview.quotes
      .filter((quote) => market === "All" || quote.market === market)
      .sort((a, b) => compare(a, b, sort.key) * (sort.desc ? -1 : 1));
  }, [overview, market, sort]);

  function sortBy(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, desc: !current.desc }
        : { key, desc: key !== "symbol" }
    );
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Screener"
        title="Stock screener"
        description="Live prices for large caps in the US and India. Click a column to sort, or a row to open the stock."
        actions={
          <div
            role="tablist"
            aria-label="Market"
            className="flex rounded-xl border border-[#2a2a2a] bg-[#111] p-1"
          >
            {FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                role="tab"
                aria-selected={market === filter}
                onClick={() => setMarket(filter)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  market === filter
                    ? "bg-[#22c55e] text-black"
                    : "text-[#999] hover:text-white"
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        }
      />

      {overview.status === "error" ? (
        <EmptyState
          icon="📡"
          title="Market data is unavailable right now"
          description="Our data providers didn't respond. Please try again in a minute."
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[#222] text-[11px] text-[#777]">
                <tr>
                  <SortHeader label="Symbol" k="symbol" sort={sort} onSort={sortBy} />
                  <th scope="col" className="hidden px-4 py-3 text-left font-medium uppercase tracking-wide sm:table-cell">
                    Market
                  </th>
                  <SortHeader label="Price" k="price" sort={sort} onSort={sortBy} align="right" />
                  <SortHeader label="Change" k="changePercent" sort={sort} onSort={sortBy} align="right" />
                </tr>
              </thead>

              <tbody>
                {overview.status === "loading"
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="border-b border-[#1b1b1b] last:border-b-0">
                        {Array.from({ length: 4 }).map((__, j) => (
                          <td key={j} className={`px-4 py-4 ${j === 1 ? "hidden sm:table-cell" : ""}`}>
                            <div className="h-3.5 w-20 animate-pulse rounded bg-[#1c1c1c]" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : rows.map((quote) => {
                      const up = (quote.changePercent ?? 0) >= 0;
                      return (
                        <tr
                          key={quote.symbol}
                          className="group border-b border-[#1b1b1b] transition-colors last:border-b-0 hover:bg-[#151515]"
                        >
                          <td className="px-4 py-3.5">
                            <Link
                              href={`/stock/${quote.symbol}`}
                              className="block focus-visible:outline-none"
                            >
                              <span className="font-semibold text-white group-hover:text-[#22c55e]">
                                {quote.symbol}
                              </span>
                              <span className="mt-0.5 block text-xs text-[#777]">
                                {quote.name}
                                <span className="sm:hidden">
                                  {quote.market === "India" ? " · NSE" : " · US"}
                                </span>
                              </span>
                            </Link>
                          </td>
                          <td className="hidden px-4 py-3.5 text-[#aaa] sm:table-cell">
                            {quote.market === "India" ? "NSE · India" : "US"}
                          </td>
                          <td className="px-4 py-3.5 text-right font-medium tabular-nums">
                            {formatQuotePrice(quote.price, quote.currency)}
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <span
                              className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${
                                up
                                  ? "bg-[#4ade80]/10 text-[#4ade80]"
                                  : "bg-[#f87171]/10 text-[#f87171]"
                              }`}
                            >
                              {formatSignedPercent(quote.changePercent)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-[#666]">
        Filters by fundamentals (P/E, market cap, sector) are coming soon.
      </p>
    </PageShell>
  );
}
