/**
 * Price-alert rules, shared by the alerts page (validation, wording) and the
 * scheduled checker (evaluation). Pure: no network, no database.
 *
 * The first four conditions are the original ones. The rest need the smart
 * alerts migration (supabase/migrations/20261025000100_smart_alerts.sql),
 * which is why ALERT_CONDITIONS marks them `smart`: the page offers them only
 * once the database accepts them.
 */

export type AlertCondition =
  | "above"
  | "below"
  | "day_up"
  | "day_down"
  | "move_pct"
  | "high_52w"
  | "low_52w"
  | "fo_ban"
  | "ipo_open"
  | "ipo_listed";
export type AlertAssetType = "stock" | "index" | "etf" | "crypto" | "ipo";
export type AlertStatus = "active" | "paused" | "triggered";
export type RepeatMode = "once" | "every_session";

type ConditionInfo = {
  id: AlertCondition;
  label: string;
  /** What the threshold box takes; "none" means the condition has no level. */
  unit: "price" | "percent" | "none";
  /** Which instruments it applies to. */
  assets: AlertAssetType[];
  /** Needs the smart alerts migration. */
  smart: boolean;
  /** Can repeat every session. */
  repeatable: boolean;
};

const MARKET: AlertAssetType[] = ["stock", "etf", "index", "crypto"];

export const ALERT_CONDITIONS: ConditionInfo[] = [
  { id: "above", label: "Price rises above", unit: "price", assets: MARKET, smart: false, repeatable: false },
  { id: "below", label: "Price falls below", unit: "price", assets: MARKET, smart: false, repeatable: false },
  { id: "day_up", label: "Day gain reaches", unit: "percent", assets: MARKET, smart: false, repeatable: true },
  { id: "day_down", label: "Day fall reaches", unit: "percent", assets: MARKET, smart: false, repeatable: true },
  { id: "move_pct", label: "Moves either way from today's price by", unit: "percent", assets: MARKET, smart: true, repeatable: false },
  { id: "high_52w", label: "Makes a new 52-week high", unit: "none", assets: MARKET, smart: true, repeatable: true },
  { id: "low_52w", label: "Makes a new 52-week low", unit: "none", assets: MARKET, smart: true, repeatable: true },
  { id: "fo_ban", label: "Enters the NSE F&O ban list", unit: "none", assets: ["stock"], smart: true, repeatable: true },
  { id: "ipo_open", label: "IPO opens for bidding", unit: "none", assets: ["ipo"], smart: true, repeatable: false },
  { id: "ipo_listed", label: "IPO lists on the exchange", unit: "none", assets: ["ipo"], smart: true, repeatable: false },
];

export const conditionInfo = (id: AlertCondition) => ALERT_CONDITIONS.find((c) => c.id === id)!;

export const MAX_ACTIVE_ALERTS = 25;

export type AlertRule = {
  condition: AlertCondition;
  threshold: number | null;
  /** move_pct only: the price when the alert was set. */
  referencePrice?: number | null;
};

export type AlertQuote = {
  price: number | null;
  changePercent: number | null;
};

/** Facts beyond the price that some conditions need; absent means "unknown". */
export type AlertContext = {
  /** The 52-week range *before* the current session, so today can break it. */
  priorRange?: { high: number; low: number } | null;
  /** Is the symbol on NSE's latest ban list? */
  onBanList?: boolean | null;
  /** The IPO's state from the IPO board. */
  ipo?: { open: boolean; listed: boolean } | null;
};

export type Evaluation = { triggered: boolean; value: number | null };

const NO: Evaluation = { triggered: false, value: null };
const usable = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function evaluateAlert(rule: AlertRule, quote: AlertQuote, context: AlertContext = {}): Evaluation {
  const { condition, threshold } = rule;
  const price = usable(quote.price) ? quote.price : null;

  switch (condition) {
    case "above":
    case "below":
      if (price === null || !usable(threshold)) return NO;
      return { triggered: condition === "above" ? price >= threshold : price <= threshold, value: price };

    case "day_up":
    case "day_down": {
      const change = quote.changePercent;
      if (change === null || !Number.isFinite(change) || !usable(threshold)) return NO;
      return { triggered: condition === "day_up" ? change >= threshold : change <= -threshold, value: change };
    }

    case "move_pct": {
      const reference = rule.referencePrice;
      if (price === null || !usable(reference) || !usable(threshold)) return NO;
      const move = ((price - reference) / reference) * 100;
      return { triggered: Math.abs(move) >= threshold, value: move };
    }

    case "high_52w":
    case "low_52w": {
      const range = context.priorRange;
      if (price === null || !range || !usable(range.high) || !usable(range.low)) return NO;
      return { triggered: condition === "high_52w" ? price > range.high : price < range.low, value: price };
    }

    case "fo_ban":
      return { triggered: context.onBanList === true, value: null };

    case "ipo_open":
      return { triggered: context.ipo?.open === true, value: null };

    case "ipo_listed":
      return { triggered: context.ipo?.listed === true, value: null };
  }
}

export type AlertInput = {
  assetType: AlertAssetType;
  symbol: string;
  condition: AlertCondition;
  threshold: number | null;
  note: string | null;
  referencePrice: number | null;
  repeatMode: RepeatMode;
};

export type AlertInputCheck = { ok: true; value: AlertInput } | { ok: false; reason: string };

const SYMBOL = /^[A-Z0-9][A-Z0-9.&-]{0,19}$/;

export function checkAlertInput(raw: {
  assetType?: unknown;
  symbol?: unknown;
  condition?: unknown;
  threshold?: unknown;
  note?: unknown;
  repeatMode?: unknown;
  currentPrice?: number | null;
}): AlertInputCheck {
  const assetType = (raw.assetType ?? "stock") as AlertAssetType;
  if (!["stock", "index", "etf", "crypto", "ipo"].includes(assetType)) return { ok: false, reason: "Unknown asset type." };

  const symbol = typeof raw.symbol === "string" ? raw.symbol.trim().toUpperCase() : "";
  if (!SYMBOL.test(symbol)) return { ok: false, reason: assetType === "ipo" ? "Pick an IPO." : "Pick a stock or index." };

  const info = ALERT_CONDITIONS.find((c) => c.id === raw.condition);
  if (!info) return { ok: false, reason: "Pick a condition." };
  const condition = info.id;
  if (!info.assets.includes(assetType)) {
    return { ok: false, reason: assetType === "ipo" ? "Pick an IPO condition." : condition === "fo_ban" ? "The F&O ban list covers stocks only." : "That condition is for IPOs." };
  }

  let threshold: number | null = null;
  if (info.unit !== "none") {
    threshold = Number(raw.threshold);
    if (!Number.isFinite(threshold) || threshold <= 0) return { ok: false, reason: "Enter a positive number." };
    if (info.unit === "percent" && threshold > 100) return { ok: false, reason: "A move can't be more than 100%." };
  }

  // An alert that is already true would fire straight away: say so instead.
  const price = raw.currentPrice ?? null;
  if (price !== null && price > 0) {
    if (condition === "above" && threshold! <= price) return { ok: false, reason: "That's at or below the current price. Pick a higher level." };
    if (condition === "below" && threshold! >= price) return { ok: false, reason: "That's at or above the current price. Pick a lower level." };
  }

  // move_pct is measured from the price when it's set, so that price is needed.
  let referencePrice: number | null = null;
  if (condition === "move_pct") {
    if (!(price !== null && price > 0)) return { ok: false, reason: "The current price isn't available yet, so the move can't be measured. Try again in a moment." };
    referencePrice = price;
  }

  const repeatMode: RepeatMode = raw.repeatMode === "every_session" && info.repeatable ? "every_session" : "once";
  const note = typeof raw.note === "string" && raw.note.trim() ? raw.note.trim().slice(0, 140) : null;
  return { ok: true, value: { assetType, symbol, condition, threshold, note, referencePrice, repeatMode } };
}

export function describeAlert(rule: AlertRule & { symbol: string }): string {
  const { symbol, threshold } = rule;
  switch (rule.condition) {
    case "above":
      return `${symbol} rises above ${threshold}`;
    case "below":
      return `${symbol} falls below ${threshold}`;
    case "day_up":
      return `${symbol} is up ${threshold}% on the day`;
    case "day_down":
      return `${symbol} is down ${threshold}% on the day`;
    case "move_pct":
      return `${symbol} moves ${threshold}% from ${rule.referencePrice ?? "the price when set"}`;
    case "high_52w":
      return `${symbol} makes a new 52-week high`;
    case "low_52w":
      return `${symbol} makes a new 52-week low`;
    case "fo_ban":
      return `${symbol} enters the F&O ban list`;
    case "ipo_open":
      return `${symbol} IPO opens for bidding`;
    case "ipo_listed":
      return `${symbol} IPO lists`;
  }
}
