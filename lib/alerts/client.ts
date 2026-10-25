"use client";

import { supabase } from "../supabase";
import { isMissingTable } from "../watchlistRules";
import type { AlertAssetType, AlertCondition, AlertInput, AlertStatus, RepeatMode } from "./rules";

/**
 * Alerts, notifications and preferences from the browser, straight to
 * Supabase under the member's own session (RLS limits every query to their
 * rows). Before migration 20261020000200_alerts.sql is applied each call
 * reports "not set up" instead of failing.
 */

export type PriceAlert = {
  id: string;
  assetType: AlertAssetType;
  symbol: string;
  condition: AlertCondition;
  threshold: number | null;
  note: string | null;
  status: AlertStatus;
  createdAt: string;
  triggeredAt: string | null;
  triggeredValue: number | null;
  referencePrice: number | null;
  repeatMode: RepeatMode;
  lastFiredAt: string | null;
};

export type AppNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  readAt: string | null;
};

export type Preferences = {
  newsRegion: "india" | "us";
  cryptoCurrency: "INR" | "USD";
  alertNotifications: boolean;
};

export const DEFAULT_PREFERENCES: Preferences = { newsRegion: "india", cryptoCurrency: "INR", alertNotifications: true };

export type Loaded<T> = { status: "ready"; value: T } | { status: "not-set-up" } | { status: "signed-out" };

async function userId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/* ------------------------------------------------------------ alerts */

type AlertRow = {
  id: string;
  asset_type: AlertAssetType;
  symbol: string;
  condition: AlertCondition;
  threshold: number | string;
  note: string | null;
  status: AlertStatus;
  created_at: string;
  triggered_at: string | null;
  triggered_value: number | string | null;
  reference_price?: number | string | null;
  repeat_mode?: RepeatMode;
  last_fired_at?: string | null;
};

const toAlert = (row: AlertRow): PriceAlert => ({
  id: row.id,
  assetType: row.asset_type,
  symbol: row.symbol,
  condition: row.condition,
  threshold: row.threshold === null ? null : Number(row.threshold),
  note: row.note,
  status: row.status,
  createdAt: row.created_at,
  triggeredAt: row.triggered_at,
  triggeredValue: row.triggered_value === null ? null : Number(row.triggered_value),
  referencePrice: row.reference_price == null ? null : Number(row.reference_price),
  repeatMode: row.repeat_mode === "every_session" ? "every_session" : "once",
  lastFiredAt: row.last_fired_at ?? null,
});

const BASE_COLUMNS = "id, asset_type, symbol, condition, threshold, note, status, created_at, triggered_at, triggered_value";
const SMART_COLUMNS = `${BASE_COLUMNS}, reference_price, repeat_mode, last_fired_at`;

/** Postgres "undefined column": the smart alerts migration isn't applied yet. */
const isMissingColumn = (error: { code?: string } | null) => error?.code === "42703" || error?.code === "PGRST204";

let smartKnown: boolean | null = null;

/**
 * Whether the database has the smart alerts migration (new conditions, repeat
 * mode). Asked once per page load with a zero-row read; until it's applied the
 * page offers only the original four conditions.
 */
export async function smartAlertsAvailable(): Promise<boolean> {
  if (smartKnown !== null) return smartKnown;
  const { error } = await supabase.from("price_alerts").select("reference_price, repeat_mode").limit(0);
  smartKnown = !error;
  return smartKnown;
}

export async function listAlerts(): Promise<Loaded<PriceAlert[]>> {
  if (!(await userId())) return { status: "signed-out" };
  const read = (columns: string) => supabase.from("price_alerts").select(columns).order("created_at", { ascending: false });
  let { data, error } = await read(SMART_COLUMNS);
  if (isMissingColumn(error)) {
    smartKnown = false;
    ({ data, error } = await read(BASE_COLUMNS));
  }
  if (isMissingTable(error)) return { status: "not-set-up" };
  if (error) throw error;
  return { status: "ready", value: (data as unknown as AlertRow[]).map(toAlert) };
}

export async function createAlert(input: AlertInput): Promise<PriceAlert> {
  const smart = await smartAlertsAvailable();
  const row = {
    asset_type: input.assetType,
    symbol: input.symbol,
    condition: input.condition,
    threshold: input.threshold,
    note: input.note,
    // Only sent once the columns exist; the original four conditions need neither.
    ...(smart ? { reference_price: input.referencePrice, repeat_mode: input.repeatMode } : {}),
  };
  const { data, error } = await supabase
    .from("price_alerts")
    .insert(row)
    .select(smart ? SMART_COLUMNS : BASE_COLUMNS)
    .single();
  if (error) throw error;
  return toAlert(data as unknown as AlertRow);
}

export async function setAlertStatus(id: string, status: "active" | "paused"): Promise<void> {
  const { error } = await supabase.from("price_alerts").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function deleteAlert(id: string): Promise<void> {
  const { error } = await supabase.from("price_alerts").delete().eq("id", id);
  if (error) throw error;
}

/* ------------------------------------------------------------ notifications */

export async function listNotifications(limit = 30): Promise<Loaded<AppNotification[]>> {
  if (!(await userId())) return { status: "signed-out" };
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, title, body, link, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (isMissingTable(error)) return { status: "not-set-up" };
  if (error) throw error;
  return {
    status: "ready",
    value: (data ?? []).map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      link: row.link,
      createdAt: row.created_at,
      readAt: row.read_at,
    })),
  };
}

export async function unreadCount(): Promise<number | null> {
  if (!(await userId())) return null;
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) return null;
  return count ?? 0;
}

export async function markAllRead(): Promise<void> {
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (error) throw error;
}

/* ------------------------------------------------------------ preferences */

export async function loadPreferences(): Promise<Loaded<Preferences>> {
  const id = await userId();
  if (!id) return { status: "signed-out" };
  const { data, error } = await supabase
    .from("user_preferences")
    .select("news_region, crypto_currency, alert_notifications")
    .eq("user_id", id)
    .maybeSingle();
  if (isMissingTable(error)) return { status: "not-set-up" };
  if (error) throw error;
  if (!data) return { status: "ready", value: DEFAULT_PREFERENCES };
  return {
    status: "ready",
    value: { newsRegion: data.news_region, cryptoCurrency: data.crypto_currency, alertNotifications: data.alert_notifications },
  };
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  const id = await userId();
  if (!id) throw new Error("Sign in to save preferences.");
  const { error } = await supabase.from("user_preferences").upsert({
    user_id: id,
    news_region: prefs.newsRegion,
    crypto_currency: prefs.cryptoCurrency,
    alert_notifications: prefs.alertNotifications,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
