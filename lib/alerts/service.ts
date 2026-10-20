import { getHistory, resolveAsset } from "../services/history";
import { getAdminClient } from "../supabase/server";
import { describeAlert, evaluateAlert, type AlertAssetType, type AlertCondition, type AlertQuote } from "./rules";

/**
 * The alert checker. Run by a scheduled job (POST /api/alerts/check): loads
 * active alerts, prices each distinct symbol once, and for each alert whose
 * rule is met marks it triggered and sends its owner a notification.
 *
 * An alert is triggered at most once (the store's update is conditional on
 * status = 'active'), so overlapping runs can't notify twice.
 */

export type ActiveAlert = {
  id: string;
  userId: string;
  assetType: AlertAssetType;
  symbol: string;
  condition: AlertCondition;
  threshold: number;
};

export type NotificationRow = { user_id: string; kind: "price_alert"; title: string; body: string; link: string };

export interface AlertStore {
  active(limit: number): Promise<ActiveAlert[]>;
  /** Mark triggered; false when it was no longer active. */
  trigger(id: string, value: number, at: string): Promise<boolean>;
  touch(ids: string[], at: string): Promise<void>;
  notify(row: NotificationRow): Promise<void>;
}

export type QuoteSource = (assetType: AlertAssetType, symbol: string) => Promise<AlertQuote | null>;

export function alertLink(assetType: AlertAssetType, symbol: string): string {
  return assetType === "stock" ? `/stock/${encodeURIComponent(symbol)}` : `/asset/${assetType}/${encodeURIComponent(symbol)}`;
}

export async function checkAlerts(
  store: AlertStore,
  quotes: QuoteSource,
  now: number = Date.now(),
  limit = 500
): Promise<{ checked: number; triggered: number; unpriced: number }> {
  const alerts = await store.active(limit);
  const at = new Date(now).toISOString();

  const keys = Array.from(new Set(alerts.map((a) => `${a.assetType}|${a.symbol}`)));
  const priced = new Map<string, AlertQuote | null>();
  for (const key of keys) {
    const [assetType, symbol] = key.split("|") as [AlertAssetType, string];
    priced.set(key, await quotes(assetType, symbol).catch(() => null));
  }

  let triggered = 0;
  let unpriced = 0;
  for (const alert of alerts) {
    const quote = priced.get(`${alert.assetType}|${alert.symbol}`) ?? null;
    if (!quote) {
      unpriced++;
      continue;
    }
    const result = evaluateAlert(alert, quote);
    if (!result.triggered || result.value === null) continue;

    if (await store.trigger(alert.id, result.value, at)) {
      triggered++;
      const shown =
        alert.condition === "above" || alert.condition === "below" ? result.value.toFixed(2) : `${result.value.toFixed(2)}%`;
      await store.notify({
        user_id: alert.userId,
        kind: "price_alert",
        title: `Alert: ${describeAlert(alert)}`,
        body: `${alert.symbol} is at ${shown}. Prices may be delayed.`,
        link: alertLink(alert.assetType, alert.symbol),
      });
    }
  }

  await store.touch(alerts.map((a) => a.id), at);
  return { checked: alerts.length, triggered, unpriced };
}

/** Latest price and day change from the cached 1-day chart history. */
export const historyQuotes: QuoteSource = async (assetType, symbol) => {
  const asset = resolveAsset(assetType, symbol);
  if (!asset) return null;
  const history = await getHistory(asset, "1d");
  const price = history?.candles.at(-1)?.c ?? null;
  const previous = history?.previousClose ?? null;
  return {
    price,
    changePercent: price !== null && previous ? ((price - previous) / previous) * 100 : null,
  };
};

export function getAlertStore(): AlertStore | null {
  const admin = getAdminClient();
  if (!admin) return null;

  return {
    async active(limit) {
      const { data, error } = await admin
        .from("price_alerts")
        .select("id, user_id, asset_type, symbol, condition, threshold")
        .eq("status", "active")
        .order("last_checked_at", { ascending: true, nullsFirst: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        userId: row.user_id,
        assetType: row.asset_type,
        symbol: row.symbol,
        condition: row.condition,
        threshold: Number(row.threshold),
      }));
    },

    async trigger(id, value, at) {
      const { data, error } = await admin
        .from("price_alerts")
        .update({ status: "triggered", triggered_at: at, triggered_value: value })
        .eq("id", id)
        .eq("status", "active")
        .select("id");
      if (error) throw error;
      return (data ?? []).length > 0;
    },

    async touch(ids, at) {
      if (ids.length === 0) return;
      const { error } = await admin.from("price_alerts").update({ last_checked_at: at }).in("id", ids);
      if (error) throw error;
    },

    async notify(row) {
      // A member who turned alert notifications off still sees the alert
      // marked triggered on the alerts page; they just get no message.
      const { data: prefs } = await admin
        .from("user_preferences")
        .select("alert_notifications")
        .eq("user_id", row.user_id)
        .maybeSingle();
      if (prefs && prefs.alert_notifications === false) return;

      const { error } = await admin.from("notifications").insert(row);
      if (error) throw error;
    },
  };
}
