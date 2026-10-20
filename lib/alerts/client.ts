"use client";

import { supabase } from "../supabase";
import { isMissingTable } from "../watchlistRules";
import type { AlertAssetType, AlertCondition, AlertStatus } from "./rules";

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
  threshold: number;
  note: string | null;
  status: AlertStatus;
  createdAt: string;
  triggeredAt: string | null;
  triggeredValue: number | null;
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
};

const toAlert = (row: AlertRow): PriceAlert => ({
  id: row.id,
  assetType: row.asset_type,
  symbol: row.symbol,
  condition: row.condition,
  threshold: Number(row.threshold),
  note: row.note,
  status: row.status,
  createdAt: row.created_at,
  triggeredAt: row.triggered_at,
  triggeredValue: row.triggered_value === null ? null : Number(row.triggered_value),
});

export async function listAlerts(): Promise<Loaded<PriceAlert[]>> {
  if (!(await userId())) return { status: "signed-out" };
  const { data, error } = await supabase
    .from("price_alerts")
    .select("id, asset_type, symbol, condition, threshold, note, status, created_at, triggered_at, triggered_value")
    .order("created_at", { ascending: false });
  if (isMissingTable(error)) return { status: "not-set-up" };
  if (error) throw error;
  return { status: "ready", value: (data as AlertRow[]).map(toAlert) };
}

export async function createAlert(input: {
  assetType: AlertAssetType;
  symbol: string;
  condition: AlertCondition;
  threshold: number;
  note: string | null;
}): Promise<PriceAlert> {
  const { data, error } = await supabase
    .from("price_alerts")
    .insert({ asset_type: input.assetType, symbol: input.symbol, condition: input.condition, threshold: input.threshold, note: input.note })
    .select("id, asset_type, symbol, condition, threshold, note, status, created_at, triggered_at, triggered_value")
    .single();
  if (error) throw error;
  return toAlert(data as AlertRow);
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
