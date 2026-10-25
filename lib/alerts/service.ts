import { getFoBanList, type FoBanList } from "../apis/nseFoBan";
import { bareIndianSymbol } from "../data/instruments/india";
import { marketSession } from "../markets/session";
import { getHistory, resolveAsset, type ResolvedAsset } from "../services/history";
import { getIpoBoard } from "../services/ipo";
import { getAdminClient } from "../supabase/server";
import { getAlertQuotes, instrumentKey, marketOf, type AlertInstrument, type AlertMarket, type PricedQuote } from "./quotes";
import { conditionInfo, describeAlert, evaluateAlert, type AlertAssetType, type AlertCondition, type AlertContext, type RepeatMode } from "./rules";

/**
 * The alert checker. Run on a schedule (POST /api/alerts/check): loads active
 * alerts, prices every distinct instrument in one batched pass, and for each
 * alert whose rule is met records the firing and notifies its owner.
 *
 * It only ever fires on a price that is new to the alert and current:
 *
 *   - a quote must be newer than the alert's creation and its last check, so a
 *     closed market's last price is judged once (the closing pass) and never
 *     again, and an alert set at the weekend can't fire on Friday's close;
 *   - while a market is scheduled open, a quote more than STALE_MS old (an
 *     exchange holiday, a stalled feed) is skipped, never acted on;
 *   - a closed market isn't re-priced every run: only for its closing pass
 *     (the alert was last checked while it was open), or every
 *     RECHECK_CLOSED_MS, which also covers a once-a-day schedule.
 *
 * Event alerts don't need a price:
 *   - F&O ban: fires when the stock is on NSE's ban list for a trade date after
 *     the alert was set (so it's news to the member), naming that date;
 *   - IPO open / listed: from the IPO board (Upstox), once.
 *
 * "Once" alerts fire a single time (the store's update is conditional on
 * status = 'active'). "Every session" alerts stay active and fire at most once
 * per session: the session is taken from the quote's own date (or the ban
 * list's trade date), and the store's alert_events row is unique per
 * (alert, session), so overlapping runs can't notify twice.
 */

export const STALE_MS = 15 * 60_000;
export const RECHECK_CLOSED_MS = 12 * 60 * 60_000;

export type ActiveAlert = {
  id: string;
  userId: string;
  assetType: AlertAssetType;
  symbol: string;
  condition: AlertCondition;
  threshold: number | null;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms of the last run that priced it; null before the first. */
  lastCheckedAt: number | null;
  referencePrice?: number | null;
  repeatMode?: RepeatMode;
  /** Exchange time (epoch ms) of the quote behind its last firing. */
  lastFiredQuoteTime?: number | null;
};

export type NotificationRow = { user_id: string; kind: "price_alert"; title: string; body: string; link: string };

export type FireRequest = {
  alert: ActiveAlert;
  value: number | null;
  price: number | null;
  currency: string | null;
  source: string;
  /** Exchange time (epoch ms) the firing is based on. */
  quoteTime: number;
  /** One firing per alert per key, e.g. "IN:2026-10-26", "FO:2026-10-27". */
  sessionKey: string;
  at: string;
};

export interface AlertStore {
  active(limit: number): Promise<ActiveAlert[]>;
  /** Record a firing; false when another run already did, or it's no longer active. */
  fire(request: FireRequest): Promise<boolean>;
  touch(ids: string[], at: string): Promise<void>;
  notify(row: NotificationRow): Promise<void>;
}

export type QuoteSource = (instruments: AlertInstrument[]) => Promise<Map<string, PricedQuote>>;

export type IpoState = { symbol: string; name: string; open: boolean; listed: boolean; closeDate: string | null; listingExchanges: string[] };

/** The non-price facts some conditions need. Each may answer null: unknown. */
export interface EventSources {
  /** Daily bars for a year, oldest first: [epoch ms, high, low]. */
  yearBars(asset: ResolvedAsset): Promise<{ t: number; high: number; low: number }[] | null>;
  foBanList(): Promise<FoBanList | null>;
  ipos(): Promise<IpoState[] | null>;
}

export type CheckResult = {
  checked: number;
  /** Alerts whose rule was tested against fresh data. */
  evaluated: number;
  triggered: number;
  /** No price or event data could be had (unknown symbol or every source failed). */
  unpriced: number;
  /** Priced, but too old to act on while the market is open. */
  stale: number;
  /** Not priced this run: the market is closed and its close was already judged. */
  marketClosed: number;
};

export function alertLink(assetType: AlertAssetType, symbol: string): string {
  if (assetType === "ipo") return "/ipo";
  return assetType === "stock" ? `/stock/${encodeURIComponent(symbol)}` : `/asset/${assetType}/${encodeURIComponent(symbol)}`;
}

const isScheduledOpen = (market: AlertMarket, at: number) =>
  market === "IN" || market === "US" ? marketSession(market, at).scheduled === "open" : true;

/** Whether this run should price an alert at all. */
export function shouldPrice(market: AlertMarket, lastCheckedAt: number | null, now: number): boolean {
  if (market === "CRYPTO" || market === "OTHER") return true;
  if (isScheduledOpen(market, now) || lastCheckedAt === null) return true;
  if (isScheduledOpen(market, lastCheckedAt)) return true; // the closing pass
  return now - lastCheckedAt >= RECHECK_CLOSED_MS;
}

/** Whether a price may be acted on for this alert. */
export function judgeQuote(alert: ActiveAlert, quote: PricedQuote, market: AlertMarket, now: number): "evaluate" | "no_new_data" | "stale" {
  if (quote.quoteTime <= Math.max(alert.createdAt, alert.lastCheckedAt ?? 0)) return "no_new_data";
  const live = market === "CRYPTO" || ((market === "IN" || market === "US") && isScheduledOpen(market, now));
  if (live && now - quote.quoteTime > STALE_MS) return "stale";
  return "evaluate";
}

const ZONE: Record<AlertMarket, { zone: string; label: string }> = {
  IN: { zone: "Asia/Kolkata", label: "IST" },
  CRYPTO: { zone: "Asia/Kolkata", label: "IST" },
  US: { zone: "America/New_York", label: "ET" },
  OTHER: { zone: "UTC", label: "UTC" },
};

/** The trading day a time belongs to, in the market's own zone: "2026-10-26". */
export function dayKey(time: number, market: AlertMarket): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE[market].zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time));
}

export function formatPrice(price: number, currency: string | null, unit: ResolvedAsset["unit"] | null): string {
  const number = price.toLocaleString(currency === "INR" ? "en-IN" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: price >= 1 ? 2 : 6 });
  if (unit === "points") return `${number} pts`;
  if (currency === "INR") return `₹${number}`;
  if (currency === "USD") return `$${number}`;
  return currency ? `${number} ${currency}` : number;
}

export function formatQuoteTime(time: number, market: AlertMarket): string {
  const { zone, label } = ZONE[market];
  const text = new Intl.DateTimeFormat("en-IN", { timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(time));
  return `${text} ${label}`;
}

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "TCS is at ₹2,612.40 (+1.20% on the day) as of 24 Oct, 14:05 IST · Upstox." */
export function notificationBody(symbol: string, quote: PricedQuote, market: AlertMarket, unit: ResolvedAsset["unit"] | null, detail = ""): string {
  const move = quote.changePercent !== null ? ` (${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}% on the day)` : "";
  return `${symbol} is at ${formatPrice(quote.price, quote.currency, unit)}${move} as of ${formatQuoteTime(quote.quoteTime, market)} · ${quote.source}.${detail}`;
}

/**
 * The 52-week high and low before the quote's own session, so today's trading
 * can set a new one. Needs most of a year of bars; null otherwise.
 */
export function priorRange(bars: { t: number; high: number; low: number }[] | null, quoteTime: number, market: AlertMarket): { high: number; low: number } | null {
  if (!bars) return null;
  const today = dayKey(quoteTime, market);
  const earlier = bars.filter((b) => dayKey(b.t, market) < today && b.high > 0 && b.low > 0);
  if (earlier.length < 200) return null; // ~a trading year; a short history isn't a 52-week range
  return { high: Math.max(...earlier.map((b) => b.high)), low: Math.min(...earlier.map((b) => b.low)) };
}

const alreadyFired = (alert: ActiveAlert, key: (time: number) => string, current: string) =>
  alert.repeatMode === "every_session" && alert.lastFiredQuoteTime != null && key(alert.lastFiredQuoteTime) === current;

export async function checkAlerts(
  store: AlertStore,
  quotes: QuoteSource,
  now: number = Date.now(),
  limit = 500,
  events: EventSources = DEFAULT_EVENT_SOURCES
): Promise<CheckResult> {
  const alerts = await store.active(limit);
  const at = new Date(now).toISOString();
  const result: CheckResult = { checked: alerts.length, evaluated: 0, triggered: 0, unpriced: 0, stale: 0, marketClosed: 0 };
  const touched: string[] = [];

  const fire = async (request: Omit<FireRequest, "at">, notification: Omit<NotificationRow, "user_id" | "kind">) => {
    if (!(await store.fire({ ...request, at }))) return;
    result.triggered++;
    await store.notify({ user_id: request.alert.userId, kind: "price_alert", ...notification });
  };

  const priceAlerts = alerts.filter((a) => a.assetType !== "ipo" && a.condition !== "fo_ban");
  const banAlerts = alerts.filter((a) => a.condition === "fo_ban");
  const ipoAlerts = alerts.filter((a) => a.assetType === "ipo");

  /* ---- price conditions ---- */
  const plan = priceAlerts.map((alert) => {
    const asset = alert.assetType === "ipo" ? null : resolveAsset(alert.assetType, alert.symbol);
    const market = asset ? marketOf(asset) : null;
    return { alert, asset, market, price: market !== null && shouldPrice(market, alert.lastCheckedAt, now) };
  });

  const wanted = plan.filter((p) => p.price).map((p) => ({ assetType: p.alert.assetType, symbol: p.alert.symbol }));
  const empty = new Map<string, PricedQuote>();
  const priced = wanted.length ? await quotes(wanted).catch(() => empty) : empty;
  const bars = new Map<string, ReturnType<EventSources["yearBars"]>>();

  for (const { alert, asset, market, price } of plan) {
    if (!asset || market === null) {
      result.unpriced++;
      continue;
    }
    if (!price) {
      result.marketClosed++;
      continue;
    }
    const quote = priced.get(instrumentKey(alert));
    if (!quote) {
      result.unpriced++;
      continue;
    }
    touched.push(alert.id);

    const verdict = judgeQuote(alert, quote, market, now);
    if (verdict === "stale") result.stale++;
    if (verdict !== "evaluate") continue;

    const sessionKey = `${market}:${dayKey(quote.quoteTime, market)}`;
    if (alreadyFired(alert, (t) => `${market}:${dayKey(t, market)}`, sessionKey)) continue;

    const context: AlertContext = {};
    if (alert.condition === "high_52w" || alert.condition === "low_52w") {
      const key = instrumentKey(alert);
      if (!bars.has(key)) bars.set(key, events.yearBars(asset).catch(() => null));
      context.priorRange = priorRange(await bars.get(key)!, quote.quoteTime, market);
      if (!context.priorRange) {
        result.unpriced++;
        continue;
      }
    }
    result.evaluated++;

    const outcome = evaluateAlert(alert, quote, context);
    if (!outcome.triggered) continue;

    const detail =
      alert.condition === "move_pct" && alert.referencePrice
        ? ` That's ${outcome.value! >= 0 ? "+" : ""}${outcome.value!.toFixed(2)}% from ${formatPrice(alert.referencePrice, quote.currency, asset.unit)} when you set the alert.`
        : alert.condition === "high_52w"
          ? ` A new 52-week high (previous high ${formatPrice(context.priorRange!.high, quote.currency, asset.unit)}).`
          : alert.condition === "low_52w"
            ? ` A new 52-week low (previous low ${formatPrice(context.priorRange!.low, quote.currency, asset.unit)}).`
            : "";

    await fire(
      { alert, value: outcome.value, price: quote.price, currency: quote.currency, source: quote.source, quoteTime: quote.quoteTime, sessionKey },
      { title: `Alert: ${describeAlert(alert)}`, body: notificationBody(alert.symbol, quote, market, asset.unit, detail), link: alertLink(alert.assetType, alert.symbol) }
    );
  }

  /* ---- F&O ban list ---- */
  if (banAlerts.length) {
    const list = await events.foBanList().catch(() => null);
    const banned = new Set((list?.securities ?? []).map((s) => s.toUpperCase()));
    for (const alert of banAlerts) {
      if (!list) {
        result.unpriced++;
        continue;
      }
      touched.push(alert.id);
      // Only a list for a later trade date than the alert's creation is news.
      if (list.tradeDate <= dayKey(alert.createdAt, "IN")) continue;
      const sessionKey = `FO:${list.tradeDate}`;
      if (alreadyFired(alert, (t) => `FO:${dayKey(t, "IN")}`, sessionKey)) continue;
      result.evaluated++;
      const symbol = bareIndianSymbol(alert.symbol);
      if (!evaluateAlert(alert, { price: null, changePercent: null }, { onBanList: banned.has(symbol) }).triggered) continue;
      await fire(
        { alert, value: null, price: null, currency: null, source: "NSE", quoteTime: Date.parse(`${list.tradeDate}T00:00:00+05:30`), sessionKey },
        {
          title: `Alert: ${symbol} is in the F&O ban`,
          body: `${symbol} is in NSE's F&O ban period for trade date ${formatDate(list.tradeDate)}: no new F&O positions until it exits. Source: NSE fo_secban.csv.`,
          link: alertLink(alert.assetType, alert.symbol),
        }
      );
    }
  }

  /* ---- IPOs ---- */
  if (ipoAlerts.length) {
    const board = await events.ipos().catch(() => null);
    for (const alert of ipoAlerts) {
      const ipo = board?.find((row) => row.symbol === alert.symbol) ?? null;
      if (!ipo) {
        result.unpriced++;
        continue;
      }
      touched.push(alert.id);
      result.evaluated++;
      if (!evaluateAlert(alert, { price: null, changePercent: null }, { ipo }).triggered) continue;
      const body =
        alert.condition === "ipo_open"
          ? `${ipo.name} is open for bidding${ipo.closeDate ? ` until ${formatDate(ipo.closeDate)}` : ""}. Source: Upstox IPO data.`
          : `${ipo.name} has listed${ipo.listingExchanges.length ? ` on ${ipo.listingExchanges.join(" and ")}` : ""}. Source: Upstox IPO data.`;
      await fire(
        { alert, value: null, price: null, currency: null, source: "Upstox IPO", quoteTime: now, sessionKey: `IPO:${alert.condition}` },
        { title: `Alert: ${describeAlert(alert)}`, body, link: alertLink("ipo", alert.symbol) }
      );
    }
  }

  await store.touch(touched, at);
  return result;
}

/** Real prices for the scheduled job: batched, timestamped, quota-free. */
export const batchedQuotes: QuoteSource = (instruments) => getAlertQuotes(instruments);

export const DEFAULT_EVENT_SOURCES: EventSources = {
  async yearBars(asset) {
    const history = await getHistory(asset, "1y");
    return history ? history.candles.map((c) => ({ t: c.t, high: c.h ?? c.c, low: c.l ?? c.c })) : null;
  },
  foBanList: () => getFoBanList(),
  async ipos() {
    const board = await getIpoBoard();
    if (!board.ok) return null;
    return board.data.ipos
      .filter((row) => row.symbol)
      .map((row) => ({
        symbol: row.symbol!.toUpperCase(),
        name: row.name,
        open: row.section === "open",
        listed: row.listingState === "listed",
        closeDate: row.closeDate || null,
        listingExchanges: row.listingExchanges,
      }));
  },
};

/* ------------------------------------------------------------ store */

const SMART_COLUMNS = "reference_price, repeat_mode, fired_quote_time";
const BASE_COLUMNS = "id, user_id, asset_type, symbol, condition, threshold, created_at, last_checked_at";

/** Postgres "undefined column": the smart alerts migration isn't applied yet. */
const isMissingColumn = (error: { code?: string } | null) => error?.code === "42703" || error?.code === "PGRST204";

export function getAlertStore(): AlertStore | null {
  const admin = getAdminClient();
  if (!admin) return null;

  // Learned on the first read: whether the database has the smart alert
  // columns. Until it does, every alert is a "once" price alert, fired the
  // original way, and no alert_events are written.
  let smart: boolean | null = null;

  const fireLegacy = async ({ alert, value, at }: FireRequest) => {
    const { data, error } = await admin
      .from("price_alerts")
      .update({ status: "triggered", triggered_at: at, triggered_value: value })
      .eq("id", alert.id)
      .eq("status", "active")
      .select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
  };

  return {
    async active(limit) {
      const read = (columns: string) =>
        admin
          .from("price_alerts")
          .select(columns)
          .eq("status", "active")
          .order("last_checked_at", { ascending: true, nullsFirst: true })
          .limit(limit);

      let { data, error } = smart === false ? await read(BASE_COLUMNS) : await read(`${BASE_COLUMNS}, ${SMART_COLUMNS}`);
      if (smart !== false && isMissingColumn(error)) {
        smart = false;
        ({ data, error } = await read(BASE_COLUMNS));
      } else if (!error && smart === null) {
        smart = true;
      }
      if (error) throw error;

      return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        userId: String(row.user_id),
        assetType: row.asset_type as AlertAssetType,
        symbol: String(row.symbol),
        condition: row.condition as AlertCondition,
        threshold: row.threshold === null ? null : Number(row.threshold),
        createdAt: Date.parse(String(row.created_at)),
        lastCheckedAt: row.last_checked_at ? Date.parse(String(row.last_checked_at)) : null,
        referencePrice: row.reference_price == null ? null : Number(row.reference_price),
        repeatMode: row.repeat_mode === "every_session" ? "every_session" : "once",
        lastFiredQuoteTime: row.fired_quote_time ? Date.parse(String(row.fired_quote_time)) : null,
      }));
    },

    async fire(request) {
      if (!smart) return fireLegacy(request);
      const { alert, value, price, currency, source, quoteTime, sessionKey, at } = request;

      // The event row goes first: it's unique per (alert, session), so of two
      // overlapping runs only one gets past this line.
      const event = await admin.from("alert_events").insert({
        alert_id: alert.id,
        user_id: alert.userId,
        value,
        price,
        currency,
        source,
        quote_time: new Date(quoteTime).toISOString(),
        session_key: sessionKey,
      });
      if (event.error?.code === "23505") return false;
      if (event.error) throw event.error;

      const fired = { last_fired_at: at, fired_source: source.slice(0, 40), fired_quote_time: new Date(quoteTime).toISOString() };
      const once = alert.repeatMode !== "every_session" || !conditionInfo(alert.condition).repeatable;
      const { data, error } = await admin
        .from("price_alerts")
        .update(once ? { ...fired, status: "triggered", triggered_at: at, triggered_value: value } : fired)
        .eq("id", alert.id)
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
