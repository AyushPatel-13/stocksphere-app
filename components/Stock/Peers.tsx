"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { signedPercent, toneClass } from "@/components/Markets/StockBits";
import { formatStatementMoney } from "@/lib/apis/yahooStatements";
import type { Peers as PeersData } from "@/lib/services/peers";

/**
 * The stock beside its closest same-sector companies, from /api/peers. Shown
 * only when there are peers to show: a US stock or one outside the NIFTY 500
 * gets no section rather than an empty one.
 */

type State = { status: "loading" } | { status: "none" } | { status: "ready"; data: PeersData };

const number = (value: number | null, digits = 2) => (value === null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits }));

export default function Peers({ symbol }: { symbol: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/peers?symbol=${encodeURIComponent(symbol)}`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setState(data?.success && Array.isArray(data.rows) && data.rows.length > 1 ? { status: "ready", data } : { status: "none" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "none" });
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (state.status === "none") return null;

  if (state.status === "loading") {
    return (
      <section aria-label="Peers" className="mt-10" aria-busy="true">
        <h2 className="mb-4 text-[22px] font-bold tracking-tight sm:text-[26px]">Peers</h2>
        <div className="h-56 animate-pulse rounded-2xl border border-[#222] bg-[#111] motion-reduce:animate-none" />
      </section>
    );
  }

  const { data } = state;
  const years = [...new Set(data.rows.map((row) => row.fiscalYearEnd).filter(Boolean))];

  return (
    <section aria-label="Peers" className="mt-10">
      <h2 className="mb-1 text-[22px] font-bold tracking-tight sm:text-[26px]">Peers</h2>
      <p className="mb-4 text-sm text-[#888]">
        {data.sector} companies in the {data.universe}, closest in market value.
      </p>

      <div className="overflow-x-auto rounded-2xl border border-[#222] bg-[#111]">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <caption className="sr-only">
            {data.symbol} compared with {data.sector} companies in the {data.universe}
          </caption>
          <thead>
            <tr className="border-b border-[#222] text-[#888]">
              <th scope="col" className="px-4 py-3 text-left font-medium">Company</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Price</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">1D</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Market cap</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">P/E</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Revenue</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Net margin</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.symbol} className={`border-b border-[#1a1a1a] last:border-b-0 ${row.isSelf ? "bg-[#22c55e]/[0.06]" : ""}`}>
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  {row.isSelf ? (
                    <span className="font-semibold text-white">
                      {row.symbol} <span className="ml-1 rounded bg-[#22c55e]/15 px-1.5 py-0.5 text-[11px] font-medium text-[#4ade80]">This stock</span>
                    </span>
                  ) : (
                    <Link href={`/stock/${encodeURIComponent(row.symbol)}`} className="font-semibold text-white hover:text-[#22c55e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500">
                      {row.symbol}
                    </Link>
                  )}
                  {row.name && <span className="block max-w-[220px] truncate text-xs text-[#888]">{row.name}</span>}
                </th>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{row.price === null ? "—" : `₹${number(row.price)}`}</td>
                <td className={`whitespace-nowrap px-3 py-3 text-right tabular-nums ${toneClass(row.changePercent)}`}>{signedPercent(row.changePercent)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatStatementMoney(row.marketCap, "INR")}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{number(row.pe, 1)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatStatementMoney(row.revenue, "INR")}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{row.netMarginPct === null ? "—" : `${row.netMarginPct.toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-[#777]">
        Sector: {data.sectorSource}. Market cap is price × shares outstanding (Yahoo Finance). P/E is market cap ÷ net income, and revenue and net margin are, for the last reported fiscal year
        {years.length === 1 ? ` (ending ${years[0]})` : ""}. “—” means the figure couldn&apos;t be sourced. A comparison, not a recommendation.
      </p>
    </section>
  );
}
