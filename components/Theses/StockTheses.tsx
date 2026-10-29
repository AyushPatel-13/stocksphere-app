"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchTheses, isApiError } from "@/lib/theses/client";
import type { ThesisView } from "@/lib/theses/service";
import { ThesisCard } from "./ThesisBits";

/** The stock page's theses section: the latest few, and a way to write one. */
export default function StockTheses({ symbol }: { symbol: string }) {
  const bare = decodeURIComponent(symbol).toUpperCase().replace(/\.(NS|BO|BSE)$/, "");
  const [state, setState] = useState<{ status: "loading" } | { status: "hidden" } | { status: "error" } | { status: "ready"; theses: ThesisView[] }>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchTheses({ symbol: bare, limit: 3 }).then((result) => {
      if (cancelled) return;
      // Not launched yet: leave the section out rather than show an error.
      if (isApiError(result)) setState(result.code === "NOT_CONFIGURED" ? { status: "hidden" } : { status: "error" });
      else setState({ status: "ready", theses: result });
    });
    return () => {
      cancelled = true;
    };
  }, [bare]);

  if (state.status === "hidden") return null;
  return (
    <section aria-labelledby="theses-title" className="mt-8">
      <div className="mb-3 flex items-center gap-3">
        <h2 id="theses-title" className="sp-section-title !m-0">Theses</h2>
        <Link href={`/theses?symbol=${encodeURIComponent(bare)}`} className="ml-auto text-sm text-[#888] hover:text-white">All</Link>
        <Link href={`/theses/new?symbol=${encodeURIComponent(decodeURIComponent(symbol))}`} className="text-sm text-[#4ade80] hover:underline">Write one</Link>
      </div>
      {state.status === "loading" && <div className="h-24 animate-pulse rounded-xl bg-[#111]" />}
      {state.status === "error" && <p className="text-sm text-[#888]">Theses are unavailable right now.</p>}
      {state.status === "ready" && state.theses.length === 0 && <p className="text-sm text-[#888]">No theses on {bare} yet.</p>}
      {state.status === "ready" && state.theses.length > 0 && (
        <ul className="space-y-3">
          {state.theses.map((thesis) => (
            <ThesisCard key={thesis.id} thesis={thesis} showSymbol={false} />
          ))}
        </ul>
      )}
    </section>
  );
}
