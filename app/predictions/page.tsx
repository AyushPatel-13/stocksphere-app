"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import PredictionBadge from "@/components/Predictions/Badge";
import BadgeGuide from "@/components/Predictions/BadgeGuide";
import PredictionCard from "@/components/Predictions/PredictionCard";
import {
  PageHeader,
  PageShell,
  StatCard,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/Page";
import { formatValue } from "@/lib/charts/format";
import { useCommunityUser, type CommunityUser } from "@/lib/community/client";
import { fetchPredictions, submitPrediction } from "@/lib/predictions/client";
import {
  HORIZONS,
  accuracy,
  badgeFor,
  nextBadge,
  type Direction,
  type Horizon,
  type PredictionAssetType,
  type PredictionStats,
} from "@/lib/predictions/rules";
import type { PredictionView } from "@/lib/predictions/service";

/**
 * Predictions: call a stock's direction over a day, a week or a month, get
 * scored against the real price, and earn badges that show next to your name
 * in the community.
 */

const ASSET_TYPES: { id: PredictionAssetType; label: string; placeholder: string }[] = [
  { id: "stock", label: "Stock", placeholder: "TCS, RELIANCE, AAPL…" },
  { id: "index", label: "Index", placeholder: "NIFTY, SENSEX, SPX…" },
  { id: "etf", label: "ETF", placeholder: "NIFTYBEES, SPY…" },
  { id: "crypto", label: "Crypto", placeholder: "BTC, ETH…" },
];

type LivePrice = { status: "idle" | "loading" | "none" } | { status: "ready"; price: number; currency: string | null; unit: string };

function useLivePrice(assetType: PredictionAssetType, symbol: string): LivePrice {
  const [state, setState] = useState<LivePrice>({ status: "idle" });
  const clean = symbol.trim().toUpperCase();

  useEffect(() => {
    if (!clean) return;
    let cancelled = false;

    const timer = window.setTimeout(async () => {
      setState({ status: "loading" });
      try {
        const params = new URLSearchParams({ type: assetType, symbol: clean, range: "1d" });
        const data = await (await fetch(`/api/history?${params.toString()}`)).json();
        if (cancelled) return;
        const last = data?.success ? data.candles?.at(-1)?.c : null;
        setState(typeof last === "number" ? { status: "ready", price: last, currency: data.currency, unit: data.unit } : { status: "none" });
      } catch {
        if (!cancelled) setState({ status: "none" });
      }
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [assetType, clean]);

  return clean ? state : { status: "idle" };
}

function PredictForm({ user, onCreated }: { user: CommunityUser; onCreated: (p: PredictionView) => void }) {
  const [assetType, setAssetType] = useState<PredictionAssetType>("stock");
  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<Direction>("up");
  const [horizon, setHorizon] = useState<Horizon>("1w");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const price = useLivePrice(assetType, symbol);

  if (user.status === "loading") return <div className="h-80 animate-pulse rounded-2xl bg-[#111]" />;

  if (user.status !== "ready") {
    return (
      <div className="rounded-2xl border border-[#222] bg-[#111] p-6 text-center">
        <p className="font-semibold">Make your first call</p>
        <p className="mt-1 text-sm text-[#888]">
          {user.status === "no-profile" ? "Pick your @handle to start predicting." : "Sign in to predict and earn badges."}
        </p>
        <Link href={user.status === "no-profile" ? "/onboarding" : "/login"} className={`${primaryButtonClass} mt-4`}>
          {user.status === "no-profile" ? "Pick handle" : "Sign in"}
        </Link>
      </div>
    );
  }

  async function submit() {
    if (!symbol.trim()) {
      setError("Enter a symbol.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await submitPrediction({ assetType, symbol: symbol.trim(), direction, horizon, target: target.trim(), note: note.trim() });
    setSaving(false);
    if ("error" in result) {
      setError(result.code === "NOT_CONFIGURED" ? "Predictions are launching soon." : result.error);
      return;
    }
    setSymbol("");
    setTarget("");
    setNote("");
    onCreated(result.prediction);
  }

  const selected = ASSET_TYPES.find((t) => t.id === assetType)!;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="rounded-2xl border border-[#222] bg-[#111] p-5"
    >
      <p className="font-semibold">New prediction</p>

      <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Asset type">
        {ASSET_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={assetType === t.id}
            onClick={() => setAssetType(t.id)}
            className={`rounded-lg border px-3 py-1 text-xs font-medium ${
              assetType === t.id ? "border-[#22c55e]/60 bg-[#22c55e]/10 text-white" : "border-[#2a2a2a] text-[#999] hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-xs font-medium text-[#888]">Symbol</span>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder={selected.placeholder}
          autoCapitalize="characters"
          className={inputClass}
        />
        <span className="mt-1.5 block min-h-[1.1rem] text-xs text-[#888]">
          {price.status === "loading" && "Getting live price…"}
          {price.status === "none" && "No live price for this symbol."}
          {price.status === "ready" && (
            <>
              Now <span className="font-semibold text-white">{formatValue(price.price, price.unit === "points" ? "points" : "currency", price.currency)}</span>
              {" "}— your entry price is locked when you submit.
            </>
          )}
        </span>
      </label>

      <div className="mt-2 grid grid-cols-2 gap-2">
        {(["up", "down"] as const).map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={direction === d}
            onClick={() => setDirection(d)}
            className={`rounded-xl border py-2.5 text-sm font-semibold transition-colors ${
              direction === d
                ? d === "up"
                  ? "border-[#22c55e]/60 bg-[#22c55e]/15 text-[#4ade80]"
                  : "border-[#ef4444]/60 bg-[#ef4444]/15 text-[#f87171]"
                : "border-[#2a2a2a] text-[#999] hover:text-white"
            }`}
          >
            {d === "up" ? "↑ Up" : "↓ Down"}
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="Time frame">
        {HORIZONS.map((h) => (
          <button
            key={h.id}
            type="button"
            aria-pressed={horizon === h.id}
            onClick={() => setHorizon(h.id)}
            className={`rounded-xl border py-2 text-xs font-medium ${
              horizon === h.id ? "border-[#3a3a3a] bg-[#1c1c1c] text-white" : "border-[#2a2a2a] text-[#999] hover:text-white"
            }`}
          >
            {h.label}
            <span className="block text-[10px] text-[#777]">{h.points} pts</span>
          </button>
        ))}
      </div>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-xs font-medium text-[#888]">Target price (optional, +5/+10 bonus)</span>
        <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" placeholder="e.g. 2600" className={inputClass} />
      </label>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-xs font-medium text-[#888]">Why? (optional)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} rows={2} placeholder="Your reasoning" className={`${inputClass} resize-none`} />
      </label>

      {error && (
        <p role="alert" className="mt-3 text-sm text-[#f87171]">
          {error}
        </p>
      )}

      <button type="submit" disabled={saving || !symbol.trim()} className={`${primaryButtonClass} mt-4 w-full`}>
        {saving ? "Saving…" : "Make prediction"}
      </button>
      <p className="mt-2 text-[11px] text-[#666]">A game of skill for points and badges — not investment advice.</p>
    </form>
  );
}

function MyRecord({ stats }: { stats: PredictionStats }) {
  const acc = accuracy(stats);
  const next = nextBadge(stats);
  const badge = badgeFor(stats);

  return (
    <section className="rounded-2xl border border-[#222] bg-[#111] p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">Your record</p>
        <PredictionBadge stats={stats} size="md" />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <StatCard label="Accuracy" value={acc === null ? "—" : `${Math.round(acc)}%`} />
        <StatCard label="Scored" value={stats.resolved} />
        <StatCard label="Points" value={stats.points} />
      </div>
      {next && (
        <p className="mt-3 text-xs text-[#888]">
          {badge ? "Next: " : "First badge: "}
          <span className="font-semibold" style={{ color: next.badge.color }}>
            {next.badge.icon} {next.badge.label}
          </span>{" "}
          — {next.needResolved > 0 ? `${next.needResolved} more scored predictions and ` : ""}
          {next.needAccuracy}%+ accuracy.
        </p>
      )}
    </section>
  );
}

type ListState = { status: "loading" } | { status: "not-configured" } | { status: "error" } | { status: "ready"; items: PredictionView[] };

export default function PredictionsPage() {
  const user = useCommunityUser();
  const [tab, setTab] = useState<"mine" | "everyone">("everyone");
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const handle = user.status === "ready" ? user.profile.username : null;
  const showMine = tab === "mine" && handle;

  useEffect(() => {
    let cancelled = false;
    fetchPredictions({ user: showMine ? handle! : undefined, limit: 40 }).then((result) => {
      if (cancelled) return;
      if (Array.isArray(result)) setList({ status: "ready", items: result });
      else setList({ status: result.code === "NOT_CONFIGURED" ? "not-configured" : "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [showMine, handle, attempt]);

  const myStats =
    list.status === "ready" && showMine ? list.items[0]?.user.stats ?? { resolved: 0, wins: 0, points: 0 } : null;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Predictions"
        title="Call the market"
        description="Predict where a stock, index, ETF or coin goes next. Get scored on the real price and earn badges the community can see."
        actions={
          <Link href="/leaderboard" className={secondaryButtonClass}>
            🏆 Leaderboard
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-6">
          <PredictForm
            user={user}
            onCreated={(prediction) => {
              setTab("mine");
              setList((current) =>
                current.status === "ready" ? { status: "ready", items: [prediction, ...current.items] } : current
              );
              setAttempt((n) => n + 1);
            }}
          />
          {myStats && <MyRecord stats={myStats} />}
          <BadgeGuide />
        </aside>

        <div className="min-w-0">
          <div className="mb-4 flex gap-2" role="tablist">
            {(["everyone", "mine"] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                disabled={id === "mine" && !handle}
                onClick={() => {
                  if (tab === id) return;
                  setTab(id);
                  setList({ status: "loading" });
                }}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
                  tab === id ? "border-[#22c55e]/60 bg-[#22c55e]/10 text-white" : "border-[#2a2a2a] text-[#aaa] hover:text-white"
                }`}
              >
                {id === "everyone" ? "Latest calls" : "My predictions"}
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
            {list.status === "loading" &&
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="border-b border-[#1b1b1b] px-5 py-4 last:border-b-0">
                  <div className="h-4 w-48 animate-pulse rounded bg-[#1a1a1a]" />
                  <div className="mt-2 h-3 w-64 animate-pulse rounded bg-[#181818]" />
                </div>
              ))}

            {list.status === "not-configured" && (
              <div className="px-6 py-12 text-center">
                <p className="text-2xl" aria-hidden="true">🎯</p>
                <p className="mt-3 font-semibold">Predictions are launching soon</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-[#888]">
                  Scored predictions and badges open as soon as community accounts are switched on.
                </p>
              </div>
            )}

            {list.status === "error" && (
              <div className="px-6 py-10 text-center">
                <p className="text-sm text-[#888]">Predictions couldn&apos;t be loaded right now.</p>
                <button
                  type="button"
                  onClick={() => {
                    setList({ status: "loading" });
                    setAttempt((n) => n + 1);
                  }}
                  className={`${secondaryButtonClass} mt-3`}
                >
                  Try again
                </button>
              </div>
            )}

            {list.status === "ready" && list.items.length === 0 && (
              <p className="px-6 py-12 text-center text-sm text-[#888]">
                {showMine ? "You haven't made any predictions yet." : "No predictions yet. Be the first to call it."}
              </p>
            )}

            {list.status === "ready" && list.items.length > 0 && (
              <ul>
                {list.items.map((prediction) => (
                  <li key={prediction.id} className="border-b border-[#1b1b1b] last:border-b-0">
                    <PredictionCard prediction={prediction} showUser={!showMine} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
