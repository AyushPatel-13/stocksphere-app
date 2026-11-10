"use client";

import { useEffect, useState } from "react";

import type { ExchangeDay } from "@/lib/markets/holidays";
import type { SessionCalendar } from "@/lib/markets/session";

/**
 * NSE's holidays and special sessions, for marketSession(). One request per
 * page load, shared by every component that asks. Until it arrives, or if it
 * can't be loaded, the calendar is empty and the badges fall back to the
 * weekday timetable.
 */

let pending: Promise<ExchangeDay[]> | null = null;

function loadCalendar(): Promise<ExchangeDay[]> {
  pending ??= fetch("/api/market/calendar")
    .then((response) => response.json())
    .then((data) => (data?.success && Array.isArray(data.india) ? (data.india as ExchangeDay[]) : []))
    .catch(() => {
      pending = null; // let a later mount try again
      return [];
    });
  return pending;
}

export function useMarketCalendar(): SessionCalendar {
  const [india, setIndia] = useState<ExchangeDay[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadCalendar().then((days) => {
      if (!cancelled) setIndia(days);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { india };
}
