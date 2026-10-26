"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import InstrumentField, { pickedFromResult, type PickedInstrument } from "@/components/Search/InstrumentField";
import { PageHeader, PageShell, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/Page";
import { storedSymbolFor } from "@/lib/search/pick";
import type { EarningsEvent } from "@/lib/services/earningsCalendar";

/**
 * Events: the upcoming US earnings calendar (Finnhub) and the member's own
 * reminders. Reminders are kept in this browser (the "events" key the page
 * has always used), so they are labelled as such.
 */

type Reminder = { symbol: string; eventType: string; eventDate: string };

const REMINDER_TYPES = ["Dividend", "Earnings", "Bonus", "Split", "AGM", "Other"];
const STORAGE_KEY = "events";

function readReminders(): Reminder[] | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(stored)
      ? stored.filter((e): e is Reminder => typeof e?.symbol === "string" && typeof e?.eventDate === "string" && typeof e?.eventType === "string")
      : null;
  } catch {
    return null;
  }
}

function writeReminders(list: Reminder[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

const HOUR_LABEL: Record<NonNullable<EarningsEvent["hour"]>, string> = {
  bmo: "Before open",
  amc: "After close",
  dmh: "During hours",
};

function formatDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function compactMoney(value: number | null): string {
  if (value === null) return "—";
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toLocaleString("en-US")}`;
}

function EarningsCalendar() {
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; events: EarningsEvent[] }>({ status: "loading" });
  const [days, setDays] = useState(7);
  const [query, setQuery] = useState("");
  const [withEstimates, setWithEstimates] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/events/earnings?days=${days}`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setState(data?.success ? { status: "ready", events: data.events } : { status: "error" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const grouped = useMemo(() => {
    if (state.status !== "ready") return [];
    const q = query.trim().toUpperCase();
    const filtered = state.events.filter((e) => (!q || e.symbol.includes(q)) && (!withEstimates || e.epsEstimate !== null || e.revenueEstimate !== null));
    const byDay = new Map<string, EarningsEvent[]>();
    for (const event of filtered) byDay.set(event.date, [...(byDay.get(event.date) ?? []), event]);
    return Array.from(byDay.entries());
  }, [state, query, withEstimates]);

  return (
    <section className="rounded-2xl border border-[#222] bg-[#111]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#1d1d1d] px-5 py-3">
        <p className="font-semibold">US earnings calendar</p>
        <div className="flex gap-1.5" role="group" aria-label="Range">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => {
                if (days === d) return;
                setDays(d);
                setState({ status: "loading" });
              }}
              className={`rounded-full border px-3 py-1 text-xs ${days === d ? "border-[#22c55e]/60 bg-[#22c55e]/10 text-white" : "border-[#2a2a2a] text-[#aaa]"}`}
            >
              {d} days
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by ticker"
          aria-label="Filter by ticker"
          className="ml-auto w-40 rounded-lg border border-[#2a2a2a] bg-black px-2.5 py-1.5 text-sm outline-none focus:border-[#22c55e]/60"
        />
        <label className="flex items-center gap-1.5 text-xs text-[#aaa]">
          <input type="checkbox" checked={withEstimates} onChange={(e) => setWithEstimates(e.target.checked)} className="accent-[#22c55e]" />
          With estimates only
        </label>
      </div>

      {state.status === "loading" && <div className="m-4 h-40 animate-pulse rounded-lg bg-[#151515]" />}
      {state.status === "error" && <p className="px-5 py-10 text-center text-sm text-[#888]">The earnings calendar is unavailable right now.</p>}
      {state.status === "ready" && grouped.length === 0 && <p className="px-5 py-10 text-center text-sm text-[#888]">No earnings match.</p>}
      {state.status === "ready" && grouped.length > 0 && (
        <div className="max-h-[640px] overflow-y-auto">
          {grouped.map(([day, events]) => (
            <div key={day}>
              <p className="sticky top-0 border-b border-[#1d1d1d] bg-[#0f0f0f] px-5 py-2 text-xs font-semibold text-[#aaa]">
                {formatDay(day)} · {events.length}
              </p>
              <ul>
                {events.map((e) => (
                  <li key={`${e.symbol}-${e.date}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#1b1b1b] px-5 py-2.5 text-sm last:border-b-0">
                    <Link href={`/stock/${encodeURIComponent(e.symbol)}`} className="w-20 font-semibold hover:text-[#22c55e]">
                      {e.symbol}
                    </Link>
                    <span className="w-28 text-xs text-[#888]">{e.hour ? HOUR_LABEL[e.hour] : "Time not given"}</span>
                    <span className="text-xs text-[#aaa]">
                      EPS est. {e.epsEstimate === null ? "—" : e.epsEstimate.toFixed(2)}
                      {e.epsActual !== null && <span className="text-white"> · actual {e.epsActual.toFixed(2)}</span>}
                    </span>
                    <span className="text-xs text-[#aaa]">
                      Revenue est. {compactMoney(e.revenueEstimate)}
                      {e.revenueActual !== null && <span className="text-white"> · actual {compactMoney(e.revenueActual)}</span>}
                    </span>
                    {e.quarter !== null && e.year !== null && <span className="ml-auto text-[11px] text-[#666]">Q{e.quarter} {e.year}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <p className="border-t border-[#1d1d1d] px-5 py-2 text-[11px] text-[#666]">
        Dates and consensus estimates from Finnhub; companies can move their dates. Indian results dates aren&apos;t available from our data sources yet.
      </p>
    </section>
  );
}

function Reminders() {
  const [reminders, setReminders] = useState<Reminder[] | null | undefined>(undefined);
  // Only an instrument picked from the shared search; an edited reminder shows its saved symbol.
  const [picked, setPicked] = useState<PickedInstrument | null>(null);
  const [eventType, setEventType] = useState("Dividend");
  const [eventDate, setEventDate] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setReminders(readReminders()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function persist(next: Reminder[]) {
    setReminders(next);
    setSaveFailed(!writeReminders(next));
  }

  function submit() {
    const clean = picked?.symbol.trim().toUpperCase() ?? "";
    if (!clean || !eventDate) return;
    const entry = { symbol: clean, eventType, eventDate };
    const list = reminders ?? [];
    persist(editing === null ? [entry, ...list] : list.map((r, i) => (i === editing ? entry : r)));
    setEditing(null);
    setPicked(null);
    setEventDate("");
    setEventType("Dividend");
  }

  const sorted = (reminders ?? []).map((r, i) => ({ ...r, i })).sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  return (
    <section className="rounded-2xl border border-[#222] bg-[#111] p-5">
      <p className="font-semibold">My reminders</p>
      <p className="mt-0.5 text-xs text-[#777]">Saved in this browser only.</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="mt-3 space-y-2"
      >
        <InstrumentField
          label="Symbol"
          inputId="reminder-symbol"
          value={picked}
          filterTypes={["stock", "etf"]}
          placeholder="Search e.g. TCS, SBI, AAPL"
          onPick={(result) => setPicked(pickedFromResult(result, storedSymbolFor(result)))}
          onClear={() => setPicked(null)}
        />
        <div className="grid grid-cols-2 gap-2">
          <select value={eventType} onChange={(e) => setEventType(e.target.value)} aria-label="Event type" className={inputClass}>
            {REMINDER_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} aria-label="Date" className={inputClass} />
        </div>
        <button type="submit" disabled={!picked || !eventDate} className={`${primaryButtonClass} w-full`}>
          {editing === null ? "Add reminder" : "Save reminder"}
        </button>
      </form>

      {reminders === null && <p className="mt-3 text-xs text-[#f87171]">Saved reminders couldn&apos;t be read in this browser.</p>}
      {saveFailed && <p className="mt-3 text-xs text-[#f87171]">This browser didn&apos;t let us save. Reminders will be lost on reload.</p>}

      {sorted.length === 0 ? (
        <p className="mt-4 text-center text-sm text-[#888]">No reminders yet.</p>
      ) : (
        <ul className="mt-4 space-y-1.5">
          {sorted.map((r) => (
            <li key={`${r.symbol}-${r.eventDate}-${r.i}`} className="flex items-center gap-2 rounded-lg border border-[#1f1f1f] px-3 py-2 text-sm">
              <span className="font-semibold">{r.symbol}</span>
              <span className="text-xs text-[#aaa]">{r.eventType}</span>
              <span className="ml-auto text-xs tabular-nums text-[#888]">{formatDay(r.eventDate)}</span>
              <button
                type="button"
                onClick={() => {
                  setEditing(r.i);
                  setPicked({ symbol: r.symbol, name: r.symbol });
                  setEventType(r.eventType);
                  setEventDate(r.eventDate);
                }}
                className="text-xs text-[#888] hover:text-white"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => persist((reminders ?? []).filter((_, i) => i !== r.i))}
                aria-label={`Delete reminder for ${r.symbol}`}
                className="text-xs text-[#888] hover:text-[#f87171]"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function EventsPage() {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Events"
        title="Events calendar"
        description="Upcoming earnings and your own reminders for dividends, results and AGMs."
        actions={
          <Link href="/news" className={secondaryButtonClass}>
            Exchange filings →
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <EarningsCalendar />
        <aside>
          <Reminders />
        </aside>
      </div>
    </PageShell>
  );
}
