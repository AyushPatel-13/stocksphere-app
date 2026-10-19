"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { StockAvatar } from "@/components/Markets/StockBits";
import { PageHeader, PageShell, secondaryButtonClass } from "@/components/ui/Page";
import { formatValue } from "@/lib/charts/format";
import type { BoardItem, HubType } from "@/lib/services/assetBoard";

/**
 * A hub page (ETFs, crypto, bonds): the catalog grouped by kind, each row with
 * its live price and day change, linking to the asset's chart page.
 */

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: BoardItem[]; fetchedAt: string };

export default function AssetHub({
  type,
  eyebrow,
  title,
  description,
  note,
}: {
  type: HubType;
  eyebrow: string;
  title: string;
  description: string;
  note?: string;
}) {
  const [vs, setVs] = useState<"INR" | "USD">("INR");
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/assets?type=${type}&vs=${vs}`)
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setState(
          data?.success ? { status: "ready", items: data.items, fetchedAt: data.fetchedAt } : { status: "error" }
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [type, vs, attempt]);

  const groups =
    state.status === "ready"
      ? state.items.reduce<Map<string, BoardItem[]>>((map, item) => {
          const key =
            type === "etf" ? `${item.region === "india" ? "India" : "US"} · ${item.group}` : item.group;
          map.set(key, [...(map.get(key) ?? []), item]);
          return map;
        }, new Map())
      : new Map<string, BoardItem[]>();

  return (
    <PageShell>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          type === "crypto" ? (
            <div role="group" aria-label="Currency" className="flex rounded-xl border border-[#2a2a2a] bg-[#111] p-1">
              {(["INR", "USD"] as const).map((currency) => (
                <button
                  key={currency}
                  type="button"
                  aria-pressed={vs === currency}
                  onClick={() => {
                    if (currency === vs) return;
                    setVs(currency);
                    setState({ status: "loading" });
                  }}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    vs === currency ? "bg-[#22c55e] text-black" : "text-[#999] hover:text-white"
                  }`}
                >
                  {currency === "INR" ? "₹ INR" : "$ USD"}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />

      {state.status === "loading" && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-[#111]" />
          ))}
        </div>
      )}

      {state.status === "error" && (
        <div className="rounded-2xl border border-[#222] bg-[#111] px-6 py-12 text-center">
          <p className="font-semibold">Prices couldn&apos;t be loaded right now</p>
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
        </div>
      )}

      {[...groups.entries()].map(([group, items]) => (
        <section key={group} className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-[#888]">{group}</h2>
          <ul className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
            {items.map((item) => {
              const up = (item.change ?? 0) >= 0;
              const href = `/asset/${type}/${encodeURIComponent(item.symbol)}${type === "crypto" ? `?vs=${vs.toLowerCase()}` : ""}`;
              return (
                <li key={item.symbol} className="border-b border-[#1b1b1b] last:border-b-0">
                  <Link href={href} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#151515] sm:px-5">
                    <StockAvatar
                      symbol={item.symbol}
                      size={36}
                      type={type}
                      market={item.region === "india" ? "India" : item.region === "us" ? "US" : "Global"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold group-hover:text-[#22c55e]">{item.name}</span>
                      <span className="block text-xs text-[#777]">
                        {item.symbol}
                        {item.unit === "currency" ? ` · ${item.currency}` : item.unit === "percent" ? " · yield" : ""}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-medium tabular-nums">
                        {item.price === null ? (
                          <span className="text-xs text-[#777]">Unavailable</span>
                        ) : (
                          formatValue(item.price, item.unit, item.currency)
                        )}
                      </span>
                      {item.price !== null && item.change !== null && (
                        <span className={`block text-xs tabular-nums ${up ? "text-[#4ade80]" : "text-[#f87171]"}`}>
                          {up ? "+" : "-"}
                          {item.unit === "percent"
                            ? `${Math.abs(item.change).toFixed(3)} pts`
                            : formatValue(Math.abs(item.change), item.unit, item.currency)}
                          {item.changePercent !== null && ` (${Math.abs(item.changePercent).toFixed(2)}%)`}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {note && <p className="text-xs leading-relaxed text-[#666]">{note}</p>}
      <p className="mt-2 text-[11px] text-[#666]">
        Prices from Yahoo Finance; may be delayed. For information only — not investment advice.
      </p>
    </PageShell>
  );
}
