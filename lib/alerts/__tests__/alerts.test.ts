import { test } from "node:test";
import assert from "node:assert/strict";

import { checkAlertInput, describeAlert, evaluateAlert } from "../rules";
import { alertLink, checkAlerts, judgeQuote, notificationBody, shouldPrice, type ActiveAlert, type AlertStore, type EventSources, type FireRequest, type NotificationRow } from "../service";
import { convertedCryptoAlertQuote, getAlertQuotes, upstoxAlertQuote, type PricedQuote } from "../quotes";
import type { ChartSeries } from "@/lib/apis/yahooChart";
import { POST } from "@/app/api/alerts/check/route";

test("price alerts trigger at or beyond their level; missing prices never trigger", () => {
  assert.deepEqual(evaluateAlert({ condition: "above", threshold: 100 }, { price: 100, changePercent: null }), { triggered: true, value: 100 });
  assert.equal(evaluateAlert({ condition: "above", threshold: 100 }, { price: 99.99, changePercent: null }).triggered, false);
  assert.equal(evaluateAlert({ condition: "below", threshold: 100 }, { price: 95, changePercent: null }).triggered, true);
  assert.equal(evaluateAlert({ condition: "below", threshold: 100 }, { price: null, changePercent: -50 }).triggered, false);
  assert.equal(evaluateAlert({ condition: "above", threshold: 1 }, { price: 0, changePercent: null }).triggered, false);
});

test("day-move alerts read the day's percentage change", () => {
  assert.equal(evaluateAlert({ condition: "day_up", threshold: 3 }, { price: 1, changePercent: 3.2 }).triggered, true);
  assert.equal(evaluateAlert({ condition: "day_up", threshold: 3 }, { price: 1, changePercent: 2.9 }).triggered, false);
  assert.equal(evaluateAlert({ condition: "day_down", threshold: 3 }, { price: 1, changePercent: -3 }).triggered, true);
  assert.equal(evaluateAlert({ condition: "day_down", threshold: 3 }, { price: 1, changePercent: 3 }).triggered, false);
  assert.equal(evaluateAlert({ condition: "day_down", threshold: 3 }, { price: 1, changePercent: null }).triggered, false);
});

test("alert input is validated, and an alert that's already true is refused", () => {
  const ok = checkAlertInput({ symbol: " tcs ", condition: "above", threshold: "2600", currentPrice: 2460 });
  assert.deepEqual(ok.ok && ok.value, { assetType: "stock", symbol: "TCS", condition: "above", threshold: 2600, note: null, referencePrice: null, repeatMode: "once" });

  const reason = (raw: Parameters<typeof checkAlertInput>[0]) => {
    const r = checkAlertInput(raw);
    return r.ok ? null : r.reason;
  };
  assert.match(reason({ symbol: "TCS", condition: "above", threshold: "2400", currentPrice: 2460 })!, /higher/);
  assert.match(reason({ symbol: "TCS", condition: "below", threshold: "2500", currentPrice: 2460 })!, /lower/);
  assert.match(reason({ symbol: "TCS", condition: "day_up", threshold: "150" })!, /100%/);
  assert.match(reason({ symbol: "TCS", condition: "above", threshold: "-1" })!, /positive/);
  assert.match(reason({ symbol: "<x>", condition: "above", threshold: "1" })!, /Pick/);
  assert.match(reason({ symbol: "TCS", condition: "sideways", threshold: "1" })!, /condition/);
  assert.match(reason({ symbol: "TCS", assetType: "bond", condition: "above", threshold: "1" })!, /asset/);

  assert.equal(describeAlert({ symbol: "TCS", condition: "day_down", threshold: 2 }), "TCS is down 2% on the day");
  assert.equal(alertLink("index", "NIFTY"), "/asset/index/NIFTY");
});

function fakeStore(alerts: ActiveAlert[], alreadyTriggered = new Set<string>()) {
  const notified: NotificationRow[] = [];
  const triggered: string[] = [];
  const touched: string[] = [];
  const fired: FireRequest[] = [];
  const store: AlertStore = {
    active: async () => alerts,
    fire: async (request) => {
      fired.push(request);
      const key = request.alert.repeatMode === "every_session" ? `${request.alert.id}|${request.sessionKey}` : request.alert.id;
      if (alreadyTriggered.has(key)) return false;
      alreadyTriggered.add(key);
      triggered.push(request.alert.id);
      return true;
    },
    touch: async (ids) => {
      touched.push(...ids);
    },
    notify: async (row) => {
      notified.push(row);
    },
  };
  return { store, notified, triggered, touched, fired };
}

// Monday 26 Oct 2026, 14:05 IST: NSE open, US closed (04:35 ET).
const NOW = Date.parse("2026-10-26T08:35:00Z");
const MIN = 60_000;

const base = { createdAt: NOW - 60 * MIN, lastCheckedAt: NOW - 5 * MIN };
const alerts: ActiveAlert[] = [
  { id: "a1", userId: "u1", assetType: "stock", symbol: "TCS", condition: "above", threshold: 2400, ...base },
  { id: "a2", userId: "u2", assetType: "stock", symbol: "TCS", condition: "below", threshold: 2000, ...base },
  { id: "a3", userId: "u1", assetType: "index", symbol: "NIFTY", condition: "day_down", threshold: 1, ...base },
  { id: "a4", userId: "u3", assetType: "stock", symbol: "INFY", condition: "above", threshold: 1, ...base },
];

const fresh = (price: number, changePercent: number | null, at = NOW - MIN): PricedQuote => ({ price, changePercent, currency: "INR", source: "Upstox", quoteTime: at });

test("the checker prices every instrument in one batch, triggers matching alerts and notifies their owners", async () => {
  const { store, notified, triggered, touched } = fakeStore(alerts);
  const batches: string[][] = [];
  const result = await checkAlerts(
    store,
    async (instruments) => {
      batches.push(instruments.map((i) => `${i.assetType}:${i.symbol}`));
      return new Map([
        ["stock|TCS", fresh(2460, -0.2)],
        ["index|NIFTY", fresh(22888, -1.11)],
      ]);
    },
    NOW
  );

  assert.equal(batches.length, 1, "one quote call per run");
  assert.deepEqual(result, { checked: 4, evaluated: 3, triggered: 2, unpriced: 1, stale: 0, marketClosed: 0 });
  assert.deepEqual(triggered, ["a1", "a3"]);
  assert.deepEqual(notified.map((n) => [n.user_id, n.link]), [["u1", "/stock/TCS"], ["u1", "/asset/index/NIFTY"]]);
  assert.equal(notified[0].body, "TCS is at ₹2,460.00 (-0.20% on the day) as of 26 Oct, 14:04 IST · Upstox.");
  assert.match(notified[1].body, /^NIFTY is at 22,888.00 pts \(-1.11% on the day\)/);
  assert.deepEqual(touched.sort(), ["a1", "a2", "a3"], "the unpriced alert isn't marked checked");
});

test("an alert another run already triggered isn't notified twice", async () => {
  const { store, notified } = fakeStore(alerts.slice(0, 1), new Set(["a1"]));
  const result = await checkAlerts(store, async () => new Map([["stock|TCS", fresh(2460, 0)]]), NOW);
  assert.equal(result.triggered, 0);
  assert.equal(notified.length, 0);
});

test("never fires on a price older than the alert or its last check, or stale while the market is open", async () => {
  const alert = alerts[0];
  assert.equal(judgeQuote(alert, fresh(2460, 0, NOW - 6 * MIN), "IN", NOW), "no_new_data", "already judged last run");
  assert.equal(judgeQuote({ ...alert, lastCheckedAt: null }, fresh(2460, 0, NOW - 61 * MIN), "IN", NOW), "no_new_data", "older than the alert");
  assert.equal(judgeQuote({ ...alert, lastCheckedAt: NOW - 30 * MIN }, fresh(2460, 0, NOW - 20 * MIN), "IN", NOW), "stale", "20 min old during NSE hours");
  assert.equal(judgeQuote(alert, fresh(2460, 0, NOW - MIN), "IN", NOW), "evaluate");

  // Saturday: an alert created at the weekend never fires on Friday's close.
  const saturday = Date.parse("2026-10-24T08:35:00Z");
  const friClose = Date.parse("2026-10-23T10:00:00Z");
  assert.equal(judgeQuote({ ...alert, createdAt: saturday - MIN, lastCheckedAt: null }, fresh(2460, 0, friClose), "IN", saturday), "no_new_data");

  const { store, triggered } = fakeStore([{ ...alert, lastCheckedAt: NOW - 30 * MIN }]);
  const result = await checkAlerts(store, async () => new Map([["stock|TCS", fresh(2460, 0, NOW - 20 * MIN)]]), NOW);
  assert.deepEqual([result.stale, result.triggered, triggered.length], [1, 0, 0]);
});

test("a closed market is priced for its closing pass, then left alone until 12 hours pass", () => {
  const tue = (h: number, m = 0) => Date.parse(`2026-10-27T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  // NSE closes 10:00 UTC (15:30 IST).
  assert.equal(shouldPrice("IN", tue(9, 55), tue(10, 5)), true, "last checked while open: closing pass");
  assert.equal(shouldPrice("IN", tue(10, 5), tue(10, 10)), false, "closing pass done");
  assert.equal(shouldPrice("IN", tue(10, 5), tue(22, 4)), false);
  assert.equal(shouldPrice("IN", tue(10, 5), tue(22, 5)), true, "12 hours later (covers a once-a-day schedule)");
  assert.equal(shouldPrice("IN", null, tue(12)), true, "never checked");
  assert.equal(shouldPrice("CRYPTO", tue(10, 5), tue(10, 10)), true, "crypto never closes");
});

test("closed-market alerts aren't sent to the quote source at all", async () => {
  // 21:00 IST: NSE closed; last checked at 15:40 IST, after the close.
  const evening = Date.parse("2026-10-26T15:30:00Z");
  const { store } = fakeStore([{ ...alerts[0], lastCheckedAt: Date.parse("2026-10-26T10:10:00Z") }]);
  let asked = 0;
  const result = await checkAlerts(
    store,
    async () => {
      asked++;
      return new Map();
    },
    evening
  );
  assert.equal(asked, 0);
  assert.equal(result.marketClosed, 1);
});

test("notification text carries currency, exchange time and source", () => {
  const usd: PricedQuote = { price: 231.5, changePercent: 2.5, currency: "USD", source: "Yahoo", quoteTime: Date.parse("2026-10-26T19:59:00Z") };
  assert.equal(notificationBody("AAPL", usd, "US", "currency"), "AAPL is at $231.50 (+2.50% on the day) as of 26 Oct, 15:59 ET · Yahoo.");
  assert.equal(notificationBody("X", { ...usd, changePercent: null }, "US", "currency"), "X is at $231.50 as of 26 Oct, 15:59 ET · Yahoo.");
});

const series = (price: number, previousClose: number, time: string, currency = "USD"): ChartSeries => ({
  name: null,
  currency,
  exchangeTimezone: null,
  previousClose,
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  regularMarketPrice: price,
  marketTime: time,
  sessionStart: null,
  sessionEnd: null,
  candles: [],
});

test("getAlertQuotes: one Upstox call for Indian symbols, Yahoo for the rest, rupee crypto from the USD pair", async () => {
  const upstoxCalls: string[][] = [];
  const yahoo: string[] = [];
  const quotes = await getAlertQuotes(
    [
      { assetType: "stock", symbol: "TCS" },
      { assetType: "stock", symbol: "INFY" },
      { assetType: "stock", symbol: "TCS" },
      { assetType: "stock", symbol: "AAPL" },
      { assetType: "crypto", symbol: "BTC" },
    ],
    {
      upstoxKey: async (asset) => (asset.upstoxSymbol === "TCS" ? "NSE_EQ|INE467B01029" : asset.upstoxSymbol === "INFY" ? "NSE_EQ|INE009A01021" : null),
      upstoxQuotes: async (keys) => {
        upstoxCalls.push(keys);
        // INFY is missing from the answer, so it falls through to Yahoo.
        return {
          data: {
            "NSE_EQ:TCS": { instrument_token: "NSE_EQ|INE467B01029", last_price: 2612.4, net_change: 30.9, prev_close_price: 2581.5, last_trade_time: String(NOW - MIN) },
          },
        };
      },
      yahooSeries: async (symbol) => {
        yahoo.push(symbol);
        if (symbol === "AAPL") return series(231.5, 225.85, "2026-10-26T08:00:00Z");
        if (symbol === "BTC-USD") return series(90_000, 88_000, "2026-10-26T08:34:00Z");
        if (symbol === "USDINR=X") return series(84, 84, "2026-10-26T08:33:00Z", "INR");
        if (symbol === "INFY.NS") return series(1500, 1490, "2026-10-26T08:30:00Z", "INR");
        return null;
      },
    }
  );

  assert.equal(upstoxCalls.length, 1);
  assert.deepEqual(upstoxCalls[0].sort(), ["NSE_EQ|INE009A01021", "NSE_EQ|INE467B01029"]);
  assert.deepEqual(yahoo.sort(), ["AAPL", "BTC-USD", "INFY.NS", "USDINR=X"]);
  assert.equal(quotes.get("stock|TCS")?.source, "Upstox");
  assert.equal(quotes.get("stock|TCS")?.changePercent?.toFixed(2), "1.20");
  assert.equal(quotes.get("stock|INFY")?.source, "Yahoo");
  const btc = quotes.get("crypto|BTC");
  assert.equal(btc?.price, 7_560_000);
  assert.equal(btc?.currency, "INR");
  assert.equal(btc?.quoteTime, Date.parse("2026-10-26T08:34:00Z"), "timed by the coin, not the FX rate");
});

test("convertedCryptoAlertQuote: no FX rate, or one over 3 days old, means no rupee price", () => {
  const btc = series(90_000, 88_000, "2026-10-26T08:34:00Z");
  assert.equal(convertedCryptoAlertQuote(btc, null), null);
  assert.equal(convertedCryptoAlertQuote(btc, series(84, 84, "2026-10-22T08:00:00Z", "INR")), null);
  assert.ok(convertedCryptoAlertQuote(btc, series(84, 84, "2026-10-24T20:00:00Z", "INR")), "a weekend-old rate is fine");
});

test("upstoxAlertQuote: an index with no previous close takes it from net_change", () => {
  const raw = { data: { "NSE_INDEX:Nifty 50": { instrument_token: "NSE_INDEX|Nifty 50", last_price: 22600, net_change: -87.65, prev_close_price: null, last_trade_time: "1792751400000" } } };
  assert.equal(upstoxAlertQuote(raw, "NSE_INDEX|Nifty 50")?.changePercent?.toFixed(3), "-0.386");
});

test("POST /api/alerts/check needs the cron secret", async () => {
  const { store } = fakeStore([]);
  const quotes = async () => new Map();
  assert.equal((await POST(new Request("http://x", { method: "POST" }), undefined, store, quotes, undefined)).status, 401);
  assert.equal((await POST(new Request("http://x", { method: "POST", headers: { Authorization: "Bearer no" } }), undefined, store, quotes, "s")).status, 401);
  assert.equal((await POST(new Request("http://x", { method: "POST", headers: { Authorization: "Bearer s" } }), undefined, null, quotes, "s")).status, 503);
  const ok = await POST(new Request("http://x", { method: "POST", headers: { Authorization: "Bearer s" } }), undefined, store, quotes, "s");
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { success: true, checked: 0, evaluated: 0, triggered: 0, unpriced: 0, stale: 0, marketClosed: 0 });
});

/* ------------------------------------------------------------ Stage B */

test("move_pct, 52-week and event rules evaluate only on the data they need", () => {
  const move = { condition: "move_pct" as const, threshold: 5, referencePrice: 2000 };
  assert.deepEqual(evaluateAlert(move, { price: 2100, changePercent: null }), { triggered: true, value: 5 });
  assert.equal(evaluateAlert(move, { price: 1900, changePercent: null }).triggered, true, "either way");
  assert.equal(evaluateAlert(move, { price: 2099, changePercent: null }).triggered, false);
  assert.equal(evaluateAlert({ ...move, referencePrice: null }, { price: 9999, changePercent: null }).triggered, false, "no reference, no firing");

  const high = { condition: "high_52w" as const, threshold: null };
  assert.equal(evaluateAlert(high, { price: 101, changePercent: null }, { priorRange: { high: 100, low: 50 } }).triggered, true);
  assert.equal(evaluateAlert(high, { price: 100, changePercent: null }, { priorRange: { high: 100, low: 50 } }).triggered, false, "equalling isn't a new high");
  assert.equal(evaluateAlert(high, { price: 101, changePercent: null }).triggered, false, "unknown range never fires");
  assert.equal(evaluateAlert({ condition: "low_52w", threshold: null }, { price: 49, changePercent: null }, { priorRange: { high: 100, low: 50 } }).triggered, true);

  assert.equal(evaluateAlert({ condition: "fo_ban", threshold: null }, { price: null, changePercent: null }, { onBanList: true }).triggered, true);
  assert.equal(evaluateAlert({ condition: "fo_ban", threshold: null }, { price: null, changePercent: null }, { onBanList: null }).triggered, false);
  assert.equal(evaluateAlert({ condition: "ipo_listed", threshold: null }, { price: null, changePercent: null }, { ipo: { open: false, listed: true } }).triggered, true);
});

test("new alert input: thresholds only where they mean something, move_pct needs today's price, IPO rules stay with IPOs", () => {
  const ok = checkAlertInput({ symbol: "TCS", condition: "move_pct", threshold: "5", repeatMode: "every_session", currentPrice: 2460 });
  assert.deepEqual(ok.ok && ok.value, { assetType: "stock", symbol: "TCS", condition: "move_pct", threshold: 5, note: null, referencePrice: 2460, repeatMode: "once" }, "move_pct can't repeat");
  const high = checkAlertInput({ symbol: "TCS", condition: "high_52w", threshold: "123", repeatMode: "every_session" });
  assert.deepEqual(high.ok && [high.value.threshold, high.value.repeatMode], [null, "every_session"]);

  const reason = (raw: Parameters<typeof checkAlertInput>[0]) => {
    const r = checkAlertInput(raw);
    return r.ok ? null : r.reason;
  };
  assert.match(reason({ symbol: "TCS", condition: "move_pct", threshold: "5" })!, /current price/);
  assert.match(reason({ assetType: "crypto", symbol: "BTC", condition: "fo_ban" })!, /stocks only/);
  assert.match(reason({ assetType: "ipo", symbol: "CORE4", condition: "above", threshold: "1" })!, /IPO condition/);
  assert.match(reason({ symbol: "TCS", condition: "ipo_open" })!, /for IPOs/);
  const ipo = checkAlertInput({ assetType: "ipo", symbol: "core4", condition: "ipo_open", repeatMode: "every_session" });
  assert.deepEqual(ipo.ok && [ipo.value.symbol, ipo.value.repeatMode, ipo.value.threshold], ["CORE4", "once", null]);
});

const NO_EVENTS: EventSources = { yearBars: async () => null, foBanList: async () => null, ipos: async () => null };

/** A year of daily bars ending the day before NOW, highs 100–2400 and lows 90+. */
function yearOfBars(highest: number) {
  return Array.from({ length: 250 }, (_, i) => ({ t: NOW - (i + 1) * 86_400_000, high: i === 10 ? highest : 2000, low: 1500 }));
}

test("a new 52-week high is judged against the range before today, and says what it beat", async () => {
  const alert: ActiveAlert = { id: "h1", userId: "u1", assetType: "stock", symbol: "TCS", condition: "high_52w", threshold: null, ...base };
  const { store, notified } = fakeStore([alert]);
  const events: EventSources = { ...NO_EVENTS, yearBars: async () => yearOfBars(2450) };
  const result = await checkAlerts(store, async () => new Map([["stock|TCS", fresh(2460, 1.2)]]), NOW, 500, events);
  assert.equal(result.triggered, 1);
  assert.match(notified[0].body, /A new 52-week high \(previous high ₹2,450.00\)\.$/);

  const below = fakeStore([alert]);
  await checkAlerts(below.store, async () => new Map([["stock|TCS", fresh(2440, 1.2)]]), NOW, 500, events);
  assert.equal(below.notified.length, 0);

  const short = fakeStore([alert]);
  const r = await checkAlerts(short.store, async () => new Map([["stock|TCS", fresh(2460, 1.2)]]), NOW, 500, { ...NO_EVENTS, yearBars: async () => yearOfBars(2450).slice(0, 50) });
  assert.deepEqual([r.triggered, r.unpriced], [0, 1], "50 days of history isn't a 52-week range");
});

test("move_pct notifications show the move from the price when the alert was set", async () => {
  const alert: ActiveAlert = { id: "m1", userId: "u1", assetType: "stock", symbol: "TCS", condition: "move_pct", threshold: 5, referencePrice: 2600, ...base };
  const { store, notified } = fakeStore([alert]);
  await checkAlerts(store, async () => new Map([["stock|TCS", fresh(2460, -1)]]), NOW, 500, NO_EVENTS);
  assert.match(notified[0].body, /That's -5\.38% from ₹2,600\.00 when you set the alert\.$/);
});

test("an every-session alert fires once per trading day, then again the next day", async () => {
  const alert: ActiveAlert = { id: "r1", userId: "u1", assetType: "stock", symbol: "TCS", condition: "day_up", threshold: 1, repeatMode: "every_session", ...base };
  const { store, fired } = fakeStore([alert]);
  await checkAlerts(store, async () => new Map([["stock|TCS", fresh(2460, 1.5)]]), NOW, 500, NO_EVENTS);
  assert.equal(fired[0].sessionKey, "IN:2026-10-26");

  // Same session, already fired (the store remembers its quote time): skipped before the store is asked.
  const again = fakeStore([{ ...alert, lastFiredQuoteTime: NOW - MIN }]);
  await checkAlerts(again.store, async () => new Map([["stock|TCS", fresh(2470, 1.8)]]), NOW, 500, NO_EVENTS);
  assert.equal(again.fired.length, 0);

  // Next morning: a new session.
  const tomorrow = NOW + 86_400_000;
  const next = fakeStore([{ ...alert, lastFiredQuoteTime: NOW - MIN, lastCheckedAt: tomorrow - 5 * MIN }]);
  await checkAlerts(next.store, async () => new Map([["stock|TCS", fresh(2500, 1.1, tomorrow - MIN)]]), tomorrow, 500, NO_EVENTS);
  assert.deepEqual(next.fired.map((f) => f.sessionKey), ["IN:2026-10-27"]);
});

test("F&O ban alerts fire for a list dated after the alert was set, and name the trade date", async () => {
  const alert: ActiveAlert = { id: "b1", userId: "u1", assetType: "stock", symbol: "SAIL", condition: "fo_ban", threshold: null, ...base };
  const list = { tradeDate: "2026-10-27", securities: ["SAIL", "RBLBANK"], sourceUrl: "https://nsearchives.nseindia.com/content/fo/fo_secban.csv" };
  const { store, notified, fired } = fakeStore([alert]);
  const result = await checkAlerts(store, async () => new Map(), NOW, 500, { ...NO_EVENTS, foBanList: async () => list });
  assert.equal(result.triggered, 1);
  assert.equal(fired[0].sessionKey, "FO:2026-10-27");
  assert.equal(notified[0].title, "Alert: SAIL is in the F&O ban");
  assert.match(notified[0].body, /trade date 27 Oct 2026/);

  // Today's list (same date the alert was set) isn't news: no firing.
  const sameDay = fakeStore([alert]);
  await checkAlerts(sameDay.store, async () => new Map(), NOW, 500, { ...NO_EVENTS, foBanList: async () => ({ ...list, tradeDate: "2026-10-26" }) });
  assert.equal(sameDay.notified.length, 0);

  // NSE unreachable: unknown, not "not banned".
  const down = fakeStore([alert]);
  const r = await checkAlerts(down.store, async () => new Map(), NOW, 500, NO_EVENTS);
  assert.deepEqual([r.unpriced, r.triggered, down.touched.length], [1, 0, 0]);
});

test("IPO alerts fire from the IPO board and link to it", async () => {
  const open: ActiveAlert = { id: "i1", userId: "u1", assetType: "ipo", symbol: "CORE4", condition: "ipo_open", threshold: null, ...base };
  const listed: ActiveAlert = { ...open, id: "i2", condition: "ipo_listed" };
  const { store, notified } = fakeStore([open, listed]);
  const ipos = async () => [{ symbol: "CORE4", name: "Core4 Engineers IPO", open: true, listed: false, closeDate: "2026-10-28", listingExchanges: ["NSE"] }];
  const result = await checkAlerts(store, async () => new Map(), NOW, 500, { ...NO_EVENTS, ipos });
  assert.deepEqual([result.evaluated, result.triggered], [2, 1]);
  assert.equal(notified[0].link, "/ipo");
  assert.equal(notified[0].body, "Core4 Engineers IPO is open for bidding until 28 Oct 2026. Source: Upstox IPO data.");
});
