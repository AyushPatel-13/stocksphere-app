"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { EmptyState, Notice, PageHeader, PageShell, primaryButtonClass } from "@/components/ui/Page";
import { fetchTheses, isApiError } from "@/lib/theses/client";
import type { ThesisView } from "@/lib/theses/service";
import { NOT_ADVICE, ThesisCard } from "./ThesisBits";

type State = { status: "loading" } | { status: "error"; message: string; code?: string } | { status: "ready"; theses: ThesisView[] };

export default function ThesesList({ symbol, user }: { symbol?: string; user?: string }) {
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchTheses({ symbol, user, mine: tab === "mine", limit: 50 }).then((result) => {
      if (cancelled) return;
      setState(isApiError(result) ? { status: "error", message: result.error, code: result.code } : { status: "ready", theses: result });
    });
    return () => {
      cancelled = true;
    };
  }, [symbol, user, tab]);

  const newHref = symbol ? `/theses/new?symbol=${encodeURIComponent(symbol)}` : "/theses/new";
  const scope = symbol ? ` on ${symbol}` : user ? ` by @${user}` : "";

  return (
    <PageShell>
      <PageHeader
        eyebrow="Theses"
        title={`Investment theses${scope}`}
        description="Members' cases for and against a stock, with their assumptions, risks and what would prove them wrong. Every edit after publishing is kept as a new version."
        actions={<Link href={newHref} className={primaryButtonClass}>Write a thesis</Link>}
      />
      <Notice>{NOT_ADVICE}</Notice>

      {!symbol && !user && (
        <div className="mb-4 flex gap-1.5" role="tablist" aria-label="Which theses">
          {(["all", "mine"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => {
                if (tab === key) return;
                setTab(key);
                setState({ status: "loading" });
              }}
              className={`rounded-full border px-3 py-1 text-sm ${tab === key ? "border-[#22c55e]/60 bg-[#22c55e]/10 text-white" : "border-[#2a2a2a] text-[#aaa]"}`}
            >
              {key === "all" ? "All" : "Mine"}
            </button>
          ))}
        </div>
      )}

      {state.status === "loading" && (
        <ul className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-28 animate-pulse rounded-xl bg-[#111]" />
          ))}
        </ul>
      )}
      {state.status === "error" && (
        <EmptyState
          title={state.code === "NOT_CONFIGURED" ? "Theses are launching soon" : state.code === "SIGNED_OUT" ? "Sign in to see your theses" : "Couldn't load theses"}
          description={state.code === "SIGNED_OUT" ? undefined : state.message}
          action={state.code === "SIGNED_OUT" ? <Link href="/login" className={primaryButtonClass}>Sign in</Link> : undefined}
        />
      )}
      {state.status === "ready" && state.theses.length === 0 && (
        <EmptyState title={`No theses${scope} yet`} description="Be the first to write one." action={<Link href={newHref} className={primaryButtonClass}>Write a thesis</Link>} />
      )}
      {state.status === "ready" && state.theses.length > 0 && (
        <ul className="space-y-3">
          {state.theses.map((thesis) => (
            <ThesisCard key={thesis.id} thesis={thesis} showSymbol={!symbol} />
          ))}
        </ul>
      )}
    </PageShell>
  );
}
