/**
 * Price alert rules. Pure: the server's checker applies them, the alerts page
 * explains them, and the tests pin them down.
 */

export type AlertCondition = "above" | "below" | "day_up" | "day_down";
export type AlertAssetType = "stock" | "index" | "etf" | "crypto";
export type AlertStatus = "active" | "paused" | "triggered";

export const ALERT_CONDITIONS: { id: AlertCondition; label: string; unit: "price" | "percent" }[] = [
  { id: "above", label: "Price rises above", unit: "price" },
  { id: "below", label: "Price falls below", unit: "price" },
  { id: "day_up", label: "Day gain reaches", unit: "percent" },
  { id: "day_down", label: "Day fall reaches", unit: "percent" },
];

export const MAX_ACTIVE_ALERTS = 25;

export type AlertRule = {
  condition: AlertCondition;
  threshold: number;
};

export type AlertQuote = {
  price: number | null;
  changePercent: number | null;
};

/**
 * Whether a quote meets the rule, and the value that met it. A missing price
 * or change never triggers anything.
 */
export function evaluateAlert(rule: AlertRule, quote: AlertQuote): { triggered: boolean; value: number | null } {
  const { condition, threshold } = rule;
  if (condition === "above" || condition === "below") {
    const price = quote.price;
    if (price === null || !Number.isFinite(price) || price <= 0) return { triggered: false, value: null };
    return { triggered: condition === "above" ? price >= threshold : price <= threshold, value: price };
  }

  const change = quote.changePercent;
  if (change === null || !Number.isFinite(change)) return { triggered: false, value: null };
  return { triggered: condition === "day_up" ? change >= threshold : change <= -threshold, value: change };
}

export type AlertInputCheck =
  | { ok: true; value: { assetType: AlertAssetType; symbol: string; condition: AlertCondition; threshold: number; note: string | null } }
  | { ok: false; reason: string };

const SYMBOL = /^[A-Z0-9][A-Z0-9.&-]{0,19}$/;

export function checkAlertInput(raw: {
  assetType?: unknown;
  symbol?: unknown;
  condition?: unknown;
  threshold?: unknown;
  note?: unknown;
  currentPrice?: number | null;
}): AlertInputCheck {
  const assetType = (raw.assetType ?? "stock") as AlertAssetType;
  if (!["stock", "index", "etf", "crypto"].includes(assetType)) return { ok: false, reason: "Unknown asset type." };

  const symbol = typeof raw.symbol === "string" ? raw.symbol.trim().toUpperCase() : "";
  if (!SYMBOL.test(symbol)) return { ok: false, reason: "Pick a stock or index." };

  const condition = raw.condition as AlertCondition;
  if (!ALERT_CONDITIONS.some((c) => c.id === condition)) return { ok: false, reason: "Pick a condition." };

  const threshold = Number(raw.threshold);
  if (!Number.isFinite(threshold) || threshold <= 0) return { ok: false, reason: "Enter a positive number." };
  if ((condition === "day_up" || condition === "day_down") && threshold > 100) {
    return { ok: false, reason: "A day move can't be more than 100%." };
  }

  // An alert that is already true would fire straight away: say so instead.
  const price = raw.currentPrice ?? null;
  if (price !== null && price > 0) {
    if (condition === "above" && threshold <= price) return { ok: false, reason: "That's at or below the current price. Pick a higher level." };
    if (condition === "below" && threshold >= price) return { ok: false, reason: "That's at or above the current price. Pick a lower level." };
  }

  const note = typeof raw.note === "string" && raw.note.trim() ? raw.note.trim().slice(0, 140) : null;
  return { ok: true, value: { assetType, symbol, condition, threshold, note } };
}

export function describeAlert(rule: AlertRule & { symbol: string }): string {
  switch (rule.condition) {
    case "above":
      return `${rule.symbol} rises above ${rule.threshold}`;
    case "below":
      return `${rule.symbol} falls below ${rule.threshold}`;
    case "day_up":
      return `${rule.symbol} is up ${rule.threshold}% on the day`;
    case "day_down":
      return `${rule.symbol} is down ${rule.threshold}% on the day`;
  }
}
