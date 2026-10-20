import { test } from "node:test";
import assert from "node:assert/strict";

import { marketTime } from "../../adapters/quote.adapter";
import { withYahooFill } from "../market.provider";
import { FALLBACK_SOURCE, chartToAssetQuote, yahooFallbackQuote, yahooTickerFor } from "../yahooFallback";
import type { ChartQuote } from "../../apis/yahooChart";

const chart = (price: number | null, marketTimeIso: string | null = "2026-10-19T09:59:38.000Z"): ChartQuote => ({
  price,
  change: price === null ? null : -4.1,
  changePercent: price === null ? null : -0.17,
  open: null,
  high: null,
  low: null,
  previousClose: price === null ? null : 2465,
  currency: "INR",
  marketTime: marketTimeIso,
  volume: 8676373,
});

test("Indian symbols map to their own NSE/BSE listing; others are unchanged", () => {
  assert.equal(yahooTickerFor("TCS"), "TCS.NS");
  assert.equal(yahooTickerFor("tcs.ns"), "TCS.NS");
  assert.equal(yahooTickerFor("RELIANCE.BSE"), "RELIANCE.BO");
  assert.equal(yahooTickerFor("INFY"), "INFY.NS");
  assert.equal(yahooTickerFor("AAPL"), "AAPL");
});

test("a chart quote becomes a labelled AssetQuote with the market's own time", () => {
  const q = chartToAssetQuote("TCS", chart(2460.9))!;
  assert.equal(q.price, 2460.9);
  assert.equal(q.source, FALLBACK_SOURCE);
  assert.equal(q.lastUpdated, "2026-10-19T09:59:38.000Z");
  assert.equal(q.volume, 8676373);
  assert.equal("open" in q, false); // missing stays missing, never 0
  assert.equal(chartToAssetQuote("TCS", chart(null)), null);
  assert.equal(chartToAssetQuote("TCS", chart(0)), null);
  assert.equal(chartToAssetQuote("TCS", null), null);
});

test("the fallback asks for the right ticker and survives a throwing lookup", async () => {
  const asked: string[] = [];
  const q = await yahooFallbackQuote("INFY", async (t) => {
    asked.push(t);
    return chart(1130.7);
  });
  assert.deepEqual(asked, ["INFY.NS"]);
  assert.equal(q?.price, 1130.7);
  assert.equal(await yahooFallbackQuote("INFY", async () => { throw new Error("down"); }), null);
});

test("bulk fill: only symbols Upstox didn't price are asked of Yahoo", async () => {
  const asked: string[] = [];
  const quotes = await withYahooFill(
    ["TCS", "INFY", "GONE"],
    [{ symbol: "TCS", price: 2460.9 }],
    async (t) => {
      asked.push(t);
      return t === "INFY.NS" ? chart(1130.7) : null;
    }
  );
  assert.deepEqual(asked, ["INFY.NS", "GONE.NS"]);
  assert.deepEqual(quotes.map((q) => [q.symbol, q.source]), [["TCS", "Upstox"], ["INFY", FALLBACK_SOURCE]]);
});

test("market time: epoch ms, epoch seconds, dates and ISO strings; junk is undefined", () => {
  assert.equal(marketTime(1792405755281), "2026-10-19T10:29:15.281Z");
  assert.equal(marketTime("1792405755281"), "2026-10-19T10:29:15.281Z");
  assert.equal(marketTime(1792416600), new Date(1792416600 * 1000).toISOString());
  assert.equal(marketTime("2026-10-19"), "2026-10-19T00:00:00.000Z");
  assert.equal(marketTime(new Date("2026-10-19T10:00:00Z")), "2026-10-19T10:00:00.000Z");
  assert.equal(marketTime(undefined), undefined);
  assert.equal(marketTime("not a date"), undefined);
  assert.equal(marketTime(0), undefined);
});
