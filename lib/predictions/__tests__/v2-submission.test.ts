import { test } from "node:test";
import assert from "node:assert/strict";

import { BONDS } from "../../data/assets";
import { SCORING_V2 } from "../v2";
import {
  chooseReference,
  defaultCloseTimeOfDayMs,
  estimateExpiry,
  isMarketOpen,
  timeOfDayMs,
  type LiveQuote,
} from "../v2/reference";
import type { ChartSeries } from "../../apis/yahooChart";
import type { History } from "../../services/history";
import {
  MAX_CONVERSION_GAP,
  completedDailyCandles,
  convertedCryptoQuote,
  createMarketData,
  parseUpstoxLiveQuote,
  yahooLiveQuote,
} from "../v2/sources";
import { isExcludedSymbol, isRequestId, parseSubmission } from "../v2/submission";

// Monday 19 Oct 2026, 08:00 UTC = 13:30 IST, inside the NSE session.
const NOW = Date.parse("2026-10-19T08:00:00.000Z");
const NSE = { start: Date.parse("2026-10-19T03:45:00.000Z"), end: Date.parse("2026-10-19T10:00:00.000Z") };
const CLOSE = { price: 98, time: Date.parse("2026-10-16T03:45:00.000Z"), source: "yahoo" as const };
const quote = (price: number, ageSeconds: number, source: LiveQuote["source"] = "upstox"): LiveQuote => ({
  price,
  quoteTime: NOW - ageSeconds * 1000,
  source,
});
const REQUEST_ID = "3f0c6a8e-1b2d-4c5e-8f9a-0b1c2d3e4f50";

/* ------------------------------------------------------------ reference */

test("market open: the first fresh live quote is the reference", () => {
  const ref = chooseReference({ assetType: "stock", now: NOW, session: NSE, live: [quote(100, 30), quote(101, 10, "yahoo")], lastClose: CLOSE });
  assert.deepEqual(ref, { mode: "live", price: 100, quoteTime: NOW - 30_000, source: "upstox" });
});

test("a stale Upstox quote falls through to a fresh Yahoo one", () => {
  const ref = chooseReference({ assetType: "stock", now: NOW, session: NSE, live: [quote(100, 600), quote(101, 20, "yahoo")], lastClose: CLOSE });
  assert.equal("error" in ref ? null : ref.source, "yahoo");
  assert.equal("error" in ref ? null : ref.price, 101);
});

test("market open with only old quotes is refused as stale, never priced from the close", () => {
  const limit = SCORING_V2.submission.maxQuoteAgeSeconds;
  assert.deepEqual(
    chooseReference({ assetType: "stock", now: NOW, session: NSE, live: [quote(100, limit + 1), quote(101, 900, "yahoo")], lastClose: CLOSE }),
    { error: "stale" }
  );
  // Exactly at the limit is still fresh.
  assert.equal("error" in chooseReference({ assetType: "stock", now: NOW, session: NSE, live: [quote(100, limit)], lastClose: CLOSE }), false);
  assert.deepEqual(chooseReference({ assetType: "stock", now: NOW, session: NSE, live: [], lastClose: CLOSE }), { error: "unavailable" });
});

test("market closed (or session unknown): the last official close, labelled from_close", () => {
  const afterHours = Date.parse("2026-10-19T12:00:00.000Z");
  const ref = chooseReference({ assetType: "stock", now: afterHours, session: NSE, live: [quote(100, 5)], lastClose: CLOSE });
  assert.deepEqual(ref, { mode: "from_close", price: 98, quoteTime: CLOSE.time, source: "yahoo" });

  const unknown = chooseReference({ assetType: "stock", now: NOW, session: null, live: [quote(100, 5)], lastClose: CLOSE });
  assert.equal("error" in unknown ? null : unknown.mode, "from_close");

  assert.deepEqual(chooseReference({ assetType: "stock", now: afterHours, session: NSE, live: [], lastClose: null }), { error: "unavailable" });
});

test("crypto ignores sessions and is always priced live", () => {
  const ref = chooseReference({ assetType: "crypto", now: NOW, session: null, live: [quote(5_000_000, 30, "yahoo")], lastClose: CLOSE });
  assert.equal("error" in ref ? null : ref.mode, "live");
  assert.deepEqual(chooseReference({ assetType: "crypto", now: NOW, session: null, live: [quote(5_000_000, 3600, "yahoo")], lastClose: CLOSE }), { error: "stale" });
});

test("future quote times and non-positive prices are never used", () => {
  assert.deepEqual(chooseReference({ assetType: "stock", now: NOW, session: NSE, live: [quote(100, -60)], lastClose: CLOSE }), { error: "stale" });
  assert.deepEqual(chooseReference({ assetType: "stock", now: NOW, session: NSE, live: [quote(0, 5), quote(-3, 5)], lastClose: CLOSE }), { error: "unavailable" });
  assert.deepEqual(
    chooseReference({ assetType: "stock", now: NOW + 10 * 3_600_000, session: NSE, live: [], lastClose: { ...CLOSE, price: 0 } }),
    { error: "unavailable" }
  );
  assert.equal(isMarketOpen(NSE, NSE.end), false);
  assert.equal(isMarketOpen(NSE, NSE.start), true);
});

/* ------------------------------------------------------------ expiry */

const nseClose = timeOfDayMs(NSE.end);
const iso = (t: number) => new Date(t).toISOString();

test("1D during the session expires at today's close", () => {
  const e = estimateExpiry({ now: NOW, horizon: "1d", assetType: "stock", closeTimeOfDayMs: nseClose });
  assert.deepEqual([e.expirySessions, e.expiresAt, iso(e.estimatedExpiryAt)], [1, null, "2026-10-19T10:00:00.000Z"]);
});

test("1D after Friday's close or at the weekend expires at Monday's close", () => {
  const fridayEvening = Date.parse("2026-10-23T11:00:00.000Z");
  const saturday = Date.parse("2026-10-24T09:00:00.000Z");
  for (const now of [fridayEvening, saturday]) {
    assert.equal(iso(estimateExpiry({ now, horizon: "1d", assetType: "index", closeTimeOfDayMs: nseClose }).estimatedExpiryAt), "2026-10-26T10:00:00.000Z");
  }
});

test("1W is the 5th weekday close and 1M the 21st", () => {
  assert.equal(iso(estimateExpiry({ now: NOW, horizon: "1w", assetType: "stock", closeTimeOfDayMs: nseClose }).estimatedExpiryAt), "2026-10-23T10:00:00.000Z");
  const month = estimateExpiry({ now: NOW, horizon: "1m", assetType: "etf", closeTimeOfDayMs: nseClose });
  assert.equal(month.expirySessions, 21);
  assert.equal(iso(month.estimatedExpiryAt), "2026-11-16T10:00:00.000Z");
});

test("crypto expires an exact number of hours after submission", () => {
  for (const [horizon, hours] of [["1d", 24], ["1w", 168], ["1m", 720]] as const) {
    const e = estimateExpiry({ now: NOW, horizon, assetType: "crypto", closeTimeOfDayMs: nseClose });
    assert.equal(e.expirySessions, null);
    assert.equal(e.expiresAt, NOW + hours * 3_600_000);
    assert.equal(e.estimatedExpiryAt, e.expiresAt);
  }
  assert.equal(defaultCloseTimeOfDayMs("INR"), 10 * 3_600_000);
});

/* ------------------------------------------------------------ submission */

const valid = { requestId: REQUEST_ID, assetType: "stock", symbol: " tcs ", direction: "up", horizon: "1w", target: "2600", note: "Strong deal pipeline" };

test("a valid submission is normalised", () => {
  const result = parseSubmission(valid);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, {
    requestId: REQUEST_ID,
    assetType: "stock",
    symbol: "TCS",
    direction: "up",
    horizon: "1w",
    target: 2600,
    note: "Strong deal pipeline",
  });

  const sideways = parseSubmission({ ...valid, direction: "sideways", target: "" });
  assert.equal(sideways.ok && sideways.value.target, null);

  for (const direction of ["up", "down", "sideways"]) {
    for (const horizon of ["1d", "1w", "1m"]) {
      assert.equal(parseSubmission({ ...valid, direction, horizon, target: undefined }).ok, true, `${direction} ${horizon}`);
    }
  }
});

test("submission refusals", () => {
  const status = (raw: Record<string, unknown>) => {
    const result = parseSubmission(raw);
    return result.ok ? 0 : result.status;
  };
  assert.equal(status({ ...valid, requestId: undefined }), 400);
  assert.equal(status({ ...valid, requestId: "not-a-uuid" }), 400);
  assert.equal(status({ ...valid, assetType: "bond" }), 400);
  assert.equal(status({ ...valid, symbol: "" }), 400);
  assert.equal(status({ ...valid, direction: "flat" }), 422);
  assert.equal(status({ ...valid, horizon: "3m" }), 422);
  assert.equal(status({ ...valid, direction: "sideways" }), 422); // has a target
  assert.equal(status({ ...valid, target: "-5" }), 422);
  assert.equal(status({ ...valid, symbol: "LIQUIDBEES" }), 422);
  assert.equal(status({ ...valid, note: "join my telegram channel for calls" }), 422);

  assert.equal(isRequestId(REQUEST_ID.toUpperCase()), true);
  assert.equal(isRequestId("00000000-0000-0000-0000-000000000000"), false);
});

test("drift guard: every Indian bond ETF is excluded from predictions", () => {
  const bondEtfs = BONDS.filter((etf) => etf.group === "Indian bond ETFs").map((etf) => etf.symbol).sort();
  assert.deepEqual([...SCORING_V2.submission.excludedSymbols].sort(), bondEtfs);
  assert.equal(isExcludedSymbol("niftybees"), false);
  assert.equal(isExcludedSymbol("gilt5ybees"), true);
});

/* ------------------------------------------------------------ provider parsing */

test("an Upstox quote is used only with its last trade time", () => {
  const raw = {
    data: {
      "NSE_EQ:TCS": { instrument_token: "NSE_EQ|INE467B01029", last_price: 2456.1, last_trade_time: String(NOW - 5000), timestamp: "2026-10-19T08:00:00.000Z" },
    },
  };
  assert.deepEqual(parseUpstoxLiveQuote(raw, "NSE_EQ|INE467B01029"), { price: 2456.1, quoteTime: NOW - 5000, source: "upstox" });
  assert.equal(parseUpstoxLiveQuote(raw, "NSE_EQ|OTHER"), null);

  const noTradeTime = { data: { x: { instrument_token: "K", last_price: 10, timestamp: "2026-10-19T08:00:00.000Z" } } };
  assert.equal(parseUpstoxLiveQuote(noTradeTime, "K"), null);
  assert.equal(parseUpstoxLiveQuote(null, "K"), null);
});

test("today's daily bar is left out while its session is running", () => {
  const candles = [
    { t: Date.parse("2026-10-16T03:45:00.000Z"), o: 1, h: 1, l: 1, c: 98, v: 0 },
    { t: NSE.start, o: 1, h: 1, l: 1, c: 100, v: 0 },
  ];
  assert.deepEqual(completedDailyCandles(candles, NSE, NOW).map((c) => c.c), [98]);
  assert.deepEqual(completedDailyCandles(candles, NSE, NSE.end + 1).map((c) => c.c), [98, 100]);
  assert.equal(yahooLiveQuote(null), null);
});

/* ------------------------------------------------------------ crypto in rupees */

// Saturday 24 Oct 2026, 17:00 UTC: crypto trades, the currency market is shut.
const SAT = Date.parse("2026-10-24T17:00:00.000Z");
const FX_SESSION = { sessionStart: Date.parse("2026-10-22T23:00:00.000Z"), sessionEnd: Date.parse("2026-10-23T22:59:00.000Z") };
const series = (price: number, time: number, session: Partial<ChartSeries> = {}): ChartSeries => ({
  name: null,
  currency: null,
  exchangeTimezone: null,
  previousClose: null,
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  regularMarketPrice: price,
  marketTime: new Date(time).toISOString(),
  sessionStart: null,
  sessionEnd: null,
  candles: [],
  ...session,
});
const BTC_USD = series(80_000, SAT - 5_000);
const FX_WEEKEND = series(94.94, Date.parse("2026-10-23T22:58:00.000Z"), FX_SESSION);

test("rupee crypto is the dollar pair at USD/INR, timed by the coin while the currency market is shut", () => {
  const quote = convertedCryptoQuote({ usd: BTC_USD, fx: FX_WEEKEND, inrReference: 7_590_000, now: SAT });
  assert.ok(quote);
  assert.equal(quote.price, 80_000 * 94.94);
  assert.equal(quote.quoteTime, SAT - 5_000);
  assert.equal(quote.source, "yahoo");
});

test("while the currency market is open the older leg sets the quote time", () => {
  const weekday = Date.parse("2026-10-23T12:00:00.000Z");
  const usd = series(80_000, weekday - 5_000);
  const fx = series(94.94, weekday - 90_000, FX_SESSION);
  assert.equal(convertedCryptoQuote({ usd, fx, inrReference: 7_595_000, now: weekday })?.quoteTime, weekday - 90_000);
  // Without a known session the rate's time counts too.
  const noSession = series(94.94, weekday - 600_000);
  const quote = convertedCryptoQuote({ usd, fx: noSession, inrReference: 7_595_000, now: weekday });
  assert.equal(quote?.quoteTime, weekday - 600_000);
  assert.deepEqual(chooseReference({ assetType: "crypto", now: weekday, session: null, live: [quote!], lastClose: null }), { error: "stale" });
});

test("a converted price is refused without a cross-check, off it, or with an old rate", () => {
  assert.equal(convertedCryptoQuote({ usd: BTC_USD, fx: FX_WEEKEND, inrReference: null, now: SAT }), null);
  // More than MAX_CONVERSION_GAP away from Yahoo's own INR pair.
  const far = 80_000 * 94.94 * (1 + MAX_CONVERSION_GAP + 0.01);
  assert.equal(convertedCryptoQuote({ usd: BTC_USD, fx: FX_WEEKEND, inrReference: far, now: SAT }), null);
  // A shut market's rate from before its latest session isn't the current rate.
  const oldRate = series(94.94, FX_SESSION.sessionStart - 1, FX_SESSION);
  assert.equal(convertedCryptoQuote({ usd: BTC_USD, fx: oldRate, inrReference: 7_590_000, now: SAT }), null);
  assert.equal(convertedCryptoQuote({ usd: null, fx: FX_WEEKEND, inrReference: 7_590_000, now: SAT }), null);
  assert.equal(convertedCryptoQuote({ usd: BTC_USD, fx: null, inrReference: 7_590_000, now: SAT }), null);
});

test("a crypto snapshot fills at the converted price when Yahoo's INR bars are minutes old", async () => {
  // Yahoo's INR pair, refreshed in batches: its newest bar started four minutes ago.
  const inrBar = { t: SAT - 240_000, o: null, h: null, l: null, c: 7_590_000, v: null };
  const intraday = { candles: [inrBar], currency: "INR", sessionStart: null, sessionEnd: null } as unknown as History;
  const asked: string[] = [];
  const market = createMarketData({
    getHistory: async (_asset, range) => (range === "1d" ? intraday : null),
    upstoxLive: async () => {
      throw new Error("crypto has no Upstox quote");
    },
    yahooLatest: async (symbol) => {
      asked.push(symbol);
      return symbol === "BTC-USD" ? BTC_USD : symbol === "USDINR=X" ? FX_WEEKEND : null;
    },
  });

  const snapshot = await market.snapshot("crypto", "BTC", SAT);
  assert.ok(snapshot);
  assert.deepEqual(asked.sort(), ["BTC-USD", "USDINR=X"]);
  const ref = chooseReference({ assetType: "crypto", now: SAT, session: snapshot.session, live: snapshot.live, lastClose: snapshot.lastClose });
  assert.deepEqual(ref, { mode: "live", price: 80_000 * 94.94, quoteTime: SAT - 5_000, source: "yahoo" });

  // Without the conversion the four-minute-old bar alone is refused, as before.
  const without = createMarketData({
    getHistory: async (_asset, range) => (range === "1d" ? intraday : null),
    upstoxLive: async () => null,
    yahooLatest: async () => null,
  });
  const old = await without.snapshot("crypto", "BTC", SAT);
  assert.deepEqual(chooseReference({ assetType: "crypto", now: SAT, session: null, live: old!.live, lastClose: null }), { error: "stale" });
});
