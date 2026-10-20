"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import AuthGuard from "@/components/AuthGuard";
import { StockAvatar } from "@/components/Markets/StockBits";
import SearchBox from "@/components/Search/SearchBox";
import { PageHeader, PageShell, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/Page";
import {
  DEFAULT_PREFERENCES,
  createAlert,
  deleteAlert,
  listAlerts,
  listNotifications,
  loadPreferences,
  markAllRead,
  savePreferences,
  setAlertStatus,
  type AppNotification,
  type Preferences,
  type PriceAlert,
} from "@/lib/alerts/client";
import { ALERT_CONDITIONS, MAX_ACTIVE_ALERTS, checkAlertInput, describeAlert, type AlertAssetType, type AlertCondition } from "@/lib/alerts/rules";
import { canonicalStockSymbol } from "@/lib/search/canonical";
import type { SearchResult } from "@/lib/search/instruments";

/**
 * Price alerts, the member's notifications and their preferences.
 *
 * Alerts are checked on the server by a scheduled job against the same
 * (possibly delayed) prices the charts use; a triggered alert sends an in-app
 * notification. Email and push aren't wired yet.
 */

type Picked = { assetType: AlertAssetType; symbol: string; name: string; price: number | null };

function assetTypeOf(result: SearchResult): AlertAssetType | null {
  return result.type === "stock" || result.type === "etf" || result.type === "index" || result.type === "crypto" ? result.type : null;
}

async function currentPrice(assetType: AlertAssetType, symbol: string): Promise<number | null> {
  try {
    const params = new URLSearchParams({ type: assetType, symbol, range: "1d" });
    const data = await (await fetch(`/api/history?${params.toString()}`)).json();
    const last = data?.success ? data.candles?.at(-1)?.c : null;
    return typeof last === "number" && last > 0 ? last : null;
  } catch {
    return null;
  }
}

function NotSetUp({ what }: { what: string }) {
  return (
    <div className="rounded-2xl border border-[#222] bg-[#111] px-6 py-10 text-center">
      <p className="text-2xl" aria-hidden="true">🔔</p>
      <p className="mt-3 font-semibold">{what} are launching soon</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-[#888]">They switch on once the alerts database update is applied.</p>
    </div>
  );
}

function NewAlertForm({ activeCount, onCreated }: { activeCount: number; onCreated: (alert: PriceAlert) => void }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [condition, setCondition] = useState<AlertCondition>("above");
  const [threshold, setThreshold] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const unit = ALERT_CONDITIONS.find((c) => c.id === condition)?.unit;

  async function pick(result: SearchResult) {
    const assetType = assetTypeOf(result);
    if (!assetType) {
      setError("Alerts work for stocks, ETFs, indices and crypto.");
      return;
    }
    const symbol = assetType === "stock" || assetType === "etf" ? canonicalStockSymbol(result.symbol, result.market) : result.symbol.toUpperCase();
    setPicked({ assetType, symbol, name: result.name, price: null });
    setError(null);
    const price = await currentPrice(assetType, symbol);
    setPicked((current) => (current && current.symbol === symbol ? { ...current, price } : current));
  }

  async function submit() {
    if (!picked) {
      setError("Pick a stock, index or coin first.");
      return;
    }
    if (activeCount >= MAX_ACTIVE_ALERTS) {
      setError(`You can have up to ${MAX_ACTIVE_ALERTS} active alerts.`);
      return;
    }
    const check = checkAlertInput({ assetType: picked.assetType, symbol: picked.symbol, condition, threshold, note, currentPrice: picked.price });
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onCreated(await createAlert(check.value));
      setThreshold("");
      setNote("");
    } catch {
      setError("Couldn't save the alert. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="rounded-2xl border border-[#222] bg-[#111] p-5"
    >
      <p className="font-semibold">New alert</p>

      <div className="mt-3">
        <SearchBox variant="compact" inputId="alert-search" placeholder="Search a stock, index or coin…" filterTypes={["stock", "etf", "index", "crypto"]} onSelect={pick} />
      </div>

      {picked && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-[#222] bg-[#0d0d0d] px-3 py-2.5">
          <StockAvatar symbol={picked.symbol} size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{picked.name}</p>
            <p className="text-xs text-[#888]">
              {picked.symbol} · {picked.price === null ? "price loading or unavailable" : `now ${picked.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
            </p>
          </div>
          <button type="button" onClick={() => setPicked(null)} className="text-xs text-[#888] hover:text-white" aria-label="Clear selection">
            ✕
          </button>
        </div>
      )}

      <label className="mt-3 block">
        <span className="mb-1.5 block text-xs font-medium text-[#888]">Alert me when</span>
        <select value={condition} onChange={(e) => setCondition(e.target.value as AlertCondition)} className={inputClass}>
          {ALERT_CONDITIONS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-xs font-medium text-[#888]">{unit === "percent" ? "Percent" : "Price"}</span>
        <input value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="decimal" placeholder={unit === "percent" ? "e.g. 3" : "e.g. 2600"} className={inputClass} />
      </label>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-xs font-medium text-[#888]">Note (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="Why this level?" className={inputClass} />
      </label>

      {error && (
        <p role="alert" className="mt-3 text-sm text-[#f87171]">
          {error}
        </p>
      )}

      <button type="submit" disabled={saving} className={`${primaryButtonClass} mt-4 w-full`}>
        {saving ? "Saving…" : "Create alert"}
      </button>
      <p className="mt-2 text-[11px] text-[#666]">Checked every few minutes against prices that may be delayed. In-app notifications only for now.</p>
    </form>
  );
}

function PreferencesCard() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not-set-up" | "saved" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    loadPreferences()
      .then((result) => {
        if (cancelled) return;
        if (result.status === "ready") {
          setPrefs(result.value);
          setState("ready");
        } else setState("not-set-up");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function update(next: Preferences) {
    setPrefs(next);
    try {
      await savePreferences(next);
      setState("saved");
    } catch {
      setState("error");
    }
  }

  if (state === "not-set-up") return null;
  const value = prefs ?? DEFAULT_PREFERENCES;

  return (
    <section className="rounded-2xl border border-[#222] bg-[#111] p-5">
      <p className="font-semibold">Preferences</p>
      <div className="mt-3 space-y-3 text-sm">
        <label className="flex items-center justify-between gap-3">
          <span className="text-[#ccc]">Default news region</span>
          <select
            value={value.newsRegion}
            disabled={state === "loading"}
            onChange={(e) => update({ ...value, newsRegion: e.target.value as Preferences["newsRegion"] })}
            className="rounded-lg border border-[#2a2a2a] bg-black px-2 py-1.5"
          >
            <option value="india">India</option>
            <option value="us">US</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-[#ccc]">Crypto prices in</span>
          <select
            value={value.cryptoCurrency}
            disabled={state === "loading"}
            onChange={(e) => update({ ...value, cryptoCurrency: e.target.value as Preferences["cryptoCurrency"] })}
            className="rounded-lg border border-[#2a2a2a] bg-black px-2 py-1.5"
          >
            <option value="INR">₹ INR</option>
            <option value="USD">$ USD</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-[#ccc]">Notify me when alerts trigger</span>
          <input
            type="checkbox"
            checked={value.alertNotifications}
            disabled={state === "loading"}
            onChange={(e) => update({ ...value, alertNotifications: e.target.checked })}
            className="h-4 w-4 accent-[#22c55e]"
          />
        </label>
      </div>
      {state === "saved" && <p className="mt-3 text-xs text-[#4ade80]">Saved.</p>}
      {state === "error" && <p className="mt-3 text-xs text-[#f87171]">Couldn&apos;t save. Please try again.</p>}
    </section>
  );
}

function timeAgo(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<PriceAlert[] | "not-set-up" | "error" | null>(null);
  const [notes, setNotes] = useState<{ items: AppNotification[]; at: number } | "not-set-up" | "error" | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAlerts()
      .then((result) => {
        if (!cancelled) setAlerts(result.status === "ready" ? result.value : "not-set-up");
      })
      .catch(() => {
        if (!cancelled) setAlerts("error");
      });
    listNotifications()
      .then((result) => {
        if (!cancelled) setNotes(result.status === "ready" ? { items: result.value, at: Date.now() } : "not-set-up");
      })
      .catch(() => {
        if (!cancelled) setNotes("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const list = Array.isArray(alerts) ? alerts : [];
  const activeCount = list.filter((a) => a.status === "active").length;

  async function toggle(alert: PriceAlert) {
    const next = alert.status === "active" ? "paused" : "active";
    try {
      await setAlertStatus(alert.id, next);
      setAlerts(list.map((a) => (a.id === alert.id ? { ...a, status: next } : a)));
    } catch {
      setAlerts("error");
    }
  }

  async function remove(alert: PriceAlert) {
    try {
      await deleteAlert(alert.id);
      setAlerts(list.filter((a) => a.id !== alert.id));
    } catch {
      setAlerts("error");
    }
  }

  async function readAll() {
    if (!notes || typeof notes === "string") return;
    try {
      await markAllRead();
      const at = new Date().toISOString();
      setNotes({ ...notes, items: notes.items.map((n) => ({ ...n, readAt: n.readAt ?? at })) });
    } catch {
      setNotes("error");
    }
  }

  return (
    <AuthGuard>
      <PageShell>
        <PageHeader eyebrow="Alerts" title="Price alerts" description="Get a notification when a stock, index or coin reaches your level." />

        {alerts === "not-set-up" ? (
          <NotSetUp what="Price alerts" />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="space-y-6">
              <NewAlertForm activeCount={activeCount} onCreated={(alert) => setAlerts([alert, ...list])} />
              <PreferencesCard />
            </aside>

            <div className="min-w-0 space-y-6">
              <section className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
                <div className="flex items-center justify-between border-b border-[#1d1d1d] px-5 py-3">
                  <p className="font-semibold">Your alerts</p>
                  <span className="text-xs text-[#777]">
                    {activeCount} active · max {MAX_ACTIVE_ALERTS}
                  </span>
                </div>
                {alerts === null && <div className="m-4 h-20 animate-pulse rounded-lg bg-[#151515]" />}
                {alerts === "error" && <p className="px-5 py-8 text-center text-sm text-[#888]">Alerts couldn&apos;t be loaded right now.</p>}
                {Array.isArray(alerts) && alerts.length === 0 && (
                  <p className="px-5 py-10 text-center text-sm text-[#888]">No alerts yet. Create one to get notified.</p>
                )}
                {Array.isArray(alerts) && alerts.length > 0 && (
                  <ul>
                    {alerts.map((alert) => (
                      <li key={alert.id} className="flex flex-wrap items-center gap-3 border-b border-[#1b1b1b] px-5 py-3.5 last:border-b-0">
                        <StockAvatar symbol={alert.symbol} size={32} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{describeAlert(alert)}</p>
                          <p className="text-xs text-[#888]">
                            {alert.status === "triggered" && alert.triggeredAt
                              ? `Triggered ${new Date(alert.triggeredAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} at ${alert.triggeredValue?.toFixed(2)}`
                              : alert.note ?? `Created ${new Date(alert.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                          </p>
                        </div>
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                            alert.status === "active"
                              ? "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#4ade80]"
                              : alert.status === "triggered"
                                ? "border-[#3b82f6]/40 bg-[#3b82f6]/10 text-[#93c5fd]"
                                : "border-[#444] bg-[#1a1a1a] text-[#999]"
                          }`}
                        >
                          {alert.status === "active" ? "Active" : alert.status === "triggered" ? "Triggered" : "Paused"}
                        </span>
                        {alert.status !== "triggered" && (
                          <button type="button" onClick={() => toggle(alert)} className="rounded-lg px-2.5 py-1 text-xs text-[#ccc] hover:bg-[#1a1a1a]">
                            {alert.status === "active" ? "Pause" : "Resume"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => remove(alert)}
                          aria-label={`Delete alert: ${describeAlert(alert)}`}
                          className="rounded-lg px-2 py-1 text-xs text-[#888] hover:bg-[#2a1414] hover:text-[#f87171]"
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section id="notifications" className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
                <div className="flex items-center justify-between border-b border-[#1d1d1d] px-5 py-3">
                  <p className="font-semibold">Notifications</p>
                  {notes && typeof notes !== "string" && notes.items.some((n) => !n.readAt) && (
                    <button type="button" onClick={readAll} className={secondaryButtonClass}>
                      Mark all read
                    </button>
                  )}
                </div>
                {notes === null && <div className="m-4 h-16 animate-pulse rounded-lg bg-[#151515]" />}
                {(notes === "error" || notes === "not-set-up") && (
                  <p className="px-5 py-8 text-center text-sm text-[#888]">Notifications couldn&apos;t be loaded right now.</p>
                )}
                {notes && typeof notes !== "string" && notes.items.length === 0 && (
                  <p className="px-5 py-8 text-center text-sm text-[#888]">Nothing yet. Triggered alerts show up here.</p>
                )}
                {notes && typeof notes !== "string" && notes.items.length > 0 && (
                  <ul>
                    {notes.items.map((n) => (
                      <li key={n.id} className={`border-b border-[#1b1b1b] last:border-b-0 ${n.readAt ? "" : "bg-[#22c55e]/[0.04]"}`}>
                        <Link href={n.link ?? "/alerts"} className="block px-5 py-3 hover:bg-[#151515]">
                          <p className="text-sm font-medium">
                            {!n.readAt && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#22c55e]" aria-label="Unread" />}
                            {n.title}
                          </p>
                          {n.body && <p className="mt-0.5 text-xs text-[#888]">{n.body}</p>}
                          <p className="mt-0.5 text-[11px] text-[#666]">{timeAgo(n.createdAt, notes.at)}</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        )}
      </PageShell>
    </AuthGuard>
  );
}
