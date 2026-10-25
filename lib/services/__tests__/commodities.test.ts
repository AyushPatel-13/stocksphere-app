import { test } from "node:test";
import assert from "node:assert/strict";

import { COMMODITIES } from "../../data/commodities";
import {
  createCommodityHistoryLoader,
  createCommodityLoader,
  istDate,
  lastSessions,
  parseContracts,
  parseQuote,
  quotesByKey,
  toCandles,
  type CommodityContract,
} from "../commodities";

// Shapes copied from live Upstox responses (2026-10-24).
const searchRow = (over: Record<string, unknown> = {}) => ({
  name: "CRUDE OIL",
  segment: "MCX_FO",
  exchange: "MCX",
  expiry: "2026-11-19",
  instrument_key: "MCX_FO|573422",
  trading_symbol: "CRUDEOIL FUT 19 NOV 26",
  tick_size: 100.0,
  lot_size: 100,
  instrument_type: "FUT",
  underlying_symbol: "CRUDEOIL",
  price_quote_unit: "BBL",
  qty_multiplier: 100,
  ...over,
});

const quoteRow = (over: Record<string, unknown> = {}) => ({
  ohlc: { open: 9516.0, high: 9828.0, low: 9495.0, close: 9784.0 },
  timestamp: "2026-10-24T18:51:28.94+05:30",
  instrument_token: "MCX_FO|573422",
  symbol: "CRUDEOIL26NOVFUT",
  last_price: 9784.0,
  volume: 42801,
  oi: 14786.0,
  net_change: 300.0,
  last_trade_time: "1792778398000",
  ...over,
});

const LAST_TRADE = 1792778398000; // 2026-10-23T17:59:58Z, 23:29 IST

test("parseContracts keeps only MCX futures of exactly this underlying, unexpired, nearest first", () => {
  const rows = [
    searchRow({ expiry: "2026-12-18", instrument_key: "MCX_FO|576264", trading_symbol: "CRUDEOIL FUT 18 DEC 26" }),
    searchRow(),
    searchRow(), // duplicate key from a second page
    searchRow({ underlying_symbol: "CRUDEOILM", instrument_key: "MCX_FO|573423" }),
    searchRow({ segment: "NSE_COM", instrument_key: "NSE_COM|134107" }),
    searchRow({ instrument_type: "CE", instrument_key: "MCX_FO|1" }),
    searchRow({ expiry: "2026-10-19", instrument_key: "MCX_FO|old" }),
    searchRow({ instrument_key: "" }),
    null,
  ];
  const contracts = parseContracts(rows, "CRUDEOIL", "2026-10-24");
  assert.deepEqual(
    contracts.map((c) => c.instrumentKey),
    ["MCX_FO|573422", "MCX_FO|576264"]
  );
  assert.deepEqual(contracts[0], {
    symbol: "CRUDEOIL",
    instrumentKey: "MCX_FO|573422",
    tradingSymbol: "CRUDEOIL FUT 19 NOV 26",
    expiry: "2026-11-19",
    lotSize: 100,
    qtyMultiplier: 100,
    tickSize: 1, // Upstox sends paise
  });
});

test("a contract expiring today is still open", () => {
  assert.equal(parseContracts([searchRow({ expiry: "2026-11-19" })], "CRUDEOIL", "2026-11-19").length, 1);
});

test("parseQuote reads price, change from the previous close, volume and OI", () => {
  const quote = parseQuote(quoteRow(), LAST_TRADE + 60_000);
  assert.ok(quote);
  assert.equal(quote.status, "live");
  assert.equal(quote.price, 9784);
  assert.equal(quote.change, 300);
  assert.equal(quote.previousClose, 9484);
  assert.equal(quote.changePercent?.toFixed(4), ((300 / 9484) * 100).toFixed(4));
  assert.equal(quote.volume, 42801);
  assert.equal(quote.openInterest, 14786);
  assert.equal(quote.lastTradeTime, "2026-10-23T17:59:58.000Z");
});

test("an old last trade is labelled as the last traded price, not live", () => {
  // Saturday afternoon, the day after the trade.
  assert.equal(parseQuote(quoteRow(), Date.parse("2026-10-24T09:00:00Z"))?.status, "last_trade");
});

test("a contract with no trades has no price, change or time — nothing is filled in", () => {
  // Live NSE_COM GOLD Nov-26 answered exactly this.
  const quote = parseQuote(
    quoteRow({ last_price: 0, net_change: 0, volume: 0, oi: 0, last_trade_time: "0", ohlc: null }),
    LAST_TRADE
  );
  assert.ok(quote);
  assert.equal(quote.status, "no_trades");
  assert.equal(quote.price, null);
  assert.equal(quote.change, null);
  assert.equal(quote.changePercent, null);
  assert.equal(quote.lastTradeTime, null);
});

test("missing net_change leaves change and previous close unknown", () => {
  const quote = parseQuote(quoteRow({ net_change: undefined }), LAST_TRADE);
  assert.equal(quote?.price, 9784);
  assert.equal(quote?.change, null);
  assert.equal(quote?.previousClose, null);
  assert.equal(quote?.changePercent, null);
});

test("quotesByKey maps Upstox's symbol-keyed response to instrument keys", () => {
  const map = quotesByKey({ "MCX_FO:CRUDEOIL26NOVFUT": quoteRow(), junk: "x" }, LAST_TRADE);
  assert.deepEqual([...map.keys()], ["MCX_FO|573422"]);
});

test("istDate uses India's calendar", () => {
  assert.equal(istDate(Date.parse("2026-10-23T19:00:00Z")), "2026-10-24"); // 00:30 IST
  assert.equal(istDate(Date.parse("2026-10-23T18:00:00Z")), "2026-10-23"); // 23:30 IST
});

/* ------------------------------------------------------------ board */

function boardDeps(over: Partial<Parameters<typeof createCommodityLoader>[0]> = {}) {
  const searches: string[] = [];
  const deps = {
    now: () => LAST_TRADE + 60_000,
    search: async (symbol: string) => {
      searches.push(symbol);
      return symbol === "CRUDEOIL" ? { ok: true as const, value: [searchRow()] } : { ok: true as const, value: [] };
    },
    quotes: async () => ({ ok: true as const, value: { "MCX_FO:CRUDEOIL26NOVFUT": quoteRow() } as Record<string, unknown> }),
    ...over,
  };
  return { deps, searches };
}

test("the board lists products with open contracts and reports the rest as unavailable", async () => {
  const { deps } = boardDeps();
  const result = await createCommodityLoader(deps).getBoard();
  assert.ok(result.ok);
  assert.deepEqual(result.value.rows.map((r) => r.symbol), ["CRUDEOIL"]);
  assert.equal(result.value.rows[0].quote?.price, 9784);
  assert.equal(result.value.rows[0].contractCount, 1);
  assert.equal(result.value.unavailable.length, COMMODITIES.length - 1);
  assert.ok(result.value.unavailable.every((entry) => entry.reason === "no_contracts"));
});

test("a product whose search failed is unavailable with the reason; the rest still show", async () => {
  const { deps } = boardDeps({
    search: async (symbol: string) =>
      symbol === "GOLD" ? { ok: false as const, code: "timeout" as const } : symbol === "CRUDEOIL" ? { ok: true as const, value: [searchRow()] } : { ok: true as const, value: [] },
  });
  const result = await createCommodityLoader(deps).getBoard();
  assert.ok(result.ok);
  assert.equal(result.value.unavailable.find((entry) => entry.symbol === "GOLD")?.reason, "timeout");
});

test("an expired token fails the whole board with code auth", async () => {
  const { deps } = boardDeps({ search: async () => ({ ok: false as const, code: "auth" as const }) });
  assert.deepEqual(await createCommodityLoader(deps).getBoard(), { ok: false, code: "auth" });
});

test("a failed quote call fails the board rather than showing contracts without prices as real", async () => {
  const { deps } = boardDeps({ quotes: async () => ({ ok: false as const, code: "rate_limited" as const }) });
  assert.deepEqual(await createCommodityLoader(deps).getBoard(), { ok: false, code: "rate_limited" });
});

test("a contract missing from the quote response keeps quote: null", async () => {
  const { deps } = boardDeps({ quotes: async () => ({ ok: true as const, value: {} }) });
  const result = await createCommodityLoader(deps).getBoard();
  assert.ok(result.ok);
  assert.equal(result.value.rows[0].quote, null);
});

test("contracts are cached between board loads", async () => {
  let now = LAST_TRADE;
  const { deps, searches } = boardDeps({ now: () => now });
  const loader = createCommodityLoader(deps);
  await loader.getBoard();
  now += 60_000; // past the quote cache, inside the contract cache
  await loader.getBoard();
  assert.equal(searches.filter((s) => s === "CRUDEOIL").length, 1);
});

test("detail lists every open contract; an unknown symbol is not_found", async () => {
  const { deps } = boardDeps({
    search: async () => ({
      ok: true as const,
      value: [searchRow(), searchRow({ expiry: "2026-12-18", instrument_key: "MCX_FO|576264" })],
    }),
  });
  const loader = createCommodityLoader(deps);
  const detail = await loader.getDetail("crudeoil");
  assert.ok(detail.ok);
  assert.deepEqual(detail.value.contracts.map((c) => c.contract.expiry), ["2026-11-19", "2026-12-18"]);
  assert.equal(detail.value.contracts[1].quote, null);
  assert.deepEqual(await loader.getDetail("BANANA"), { ok: false, code: "not_found" });
});

/* ------------------------------------------------------------ history */

const contract: CommodityContract = {
  symbol: "CRUDEOIL",
  instrumentKey: "MCX_FO|573422",
  tradingSymbol: "CRUDEOIL FUT 19 NOV 26",
  expiry: "2026-11-19",
  lotSize: 100,
  qtyMultiplier: 100,
  tickSize: 1,
};

test("toCandles turns Upstox rows (newest first) into ascending candles", () => {
  const candles = toCandles([
    ["2026-10-23T23:29:00+05:30", 9781, 9786, 9750, 9784, 184, 14803],
    ["2026-10-23T23:28:00+05:30", 9797, 9797, 9770, 9783, 237, 14900],
    ["bad", 1, 1, 1, 1, 1, 1],
    "junk",
  ]);
  assert.deepEqual(candles, [
    { t: Date.parse("2026-10-23T23:28:00+05:30"), o: 9797, h: 9797, l: 9770, c: 9783, v: 237 },
    { t: Date.parse("2026-10-23T23:29:00+05:30"), o: 9781, h: 9786, l: 9750, c: 9784, v: 184 },
  ]);
});

test("lastSessions keeps the newest trading days by Indian date", () => {
  const candles = toCandles([
    ["2026-10-22T23:00:00+05:30", 1, 1, 1, 1, 1],
    ["2026-10-23T09:00:00+05:30", 2, 2, 2, 2, 1],
    ["2026-10-23T23:29:00+05:30", 3, 3, 3, 3, 1],
  ]);
  assert.deepEqual(lastSessions(candles, 1).map((c) => c.c), [2, 3]);
});

test("1D history: the last session's minute candles plus the quote's previous close", async () => {
  const calls: string[] = [];
  const load = createCommodityHistoryLoader({
    now: () => Date.parse("2026-10-24T09:00:00Z"),
    contracts: async () => ({ ok: true, value: [contract] }),
    candles: async (key, unit, interval, from, to) => {
      calls.push(`${key} ${unit}/${interval} ${from}..${to}`);
      return {
        ok: true,
        value: [
          ["2026-10-23T23:29:00+05:30", 9781, 9786, 9750, 9784, 184, 14803],
          ["2026-10-22T23:29:00+05:30", 9400, 9480, 9390, 9484, 100, 14000],
        ],
      };
    },
    intraday: async () => ({ ok: true, value: [] }), // Saturday: no session
    quotes: async () => ({ ok: true, value: { x: quoteRow() } }),
  });
  const result = await load("CRUDEOIL", null, "1d");
  assert.ok(result.ok && result.value);
  assert.deepEqual(calls, ["MCX_FO|573422 minutes/1 2026-10-17..2026-10-24"]);
  assert.deepEqual(result.value.candles.map((c) => c.c), [9784]);
  assert.equal(result.value.previousClose, 9484);
  assert.equal(result.value.interval, "1m");
  assert.equal(result.value.currency, "INR");
  assert.equal(result.value.source, "Upstox");
});

test("history for an expiry that isn't open is not_found; no candles is null, not an error", async () => {
  const deps = {
    now: () => LAST_TRADE,
    contracts: async () => ({ ok: true as const, value: [contract] }),
    candles: async () => ({ ok: true as const, value: [] }),
    intraday: async () => ({ ok: true as const, value: [] }),
    quotes: async () => ({ ok: true as const, value: {} }),
  };
  assert.deepEqual(await createCommodityHistoryLoader(deps)("CRUDEOIL", "2027-05-01", "1mo"), { ok: false, code: "not_found" });
  assert.deepEqual(await createCommodityHistoryLoader(deps)("CRUDEOIL", "2026-11-19", "1y"), { ok: true, value: null });
});
