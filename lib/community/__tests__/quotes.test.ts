import { test } from "node:test";
import assert from "node:assert/strict";

import type { AssetQuote } from "../../types/quote";
import { attachContext, type ContextDeps } from "../entities";
import type { StoredMention } from "../mentions";
import { QUOTE_TTL_MS, formatQuote, quotableSymbol, quoteCache, toStockQuote } from "../quotes";
import type { PostView } from "../types";

/** Price previews on stock tags: verified market data only, one batch per page. */

const sbin: StoredMention = { kind: "instrument", id: "India:SBIN", type: "stock", symbol: "SBIN", exchange: "NSE", name: "State Bank of India", href: "/stock/SBIN", start: 0, end: 5 };
const tcs: StoredMention = { kind: "instrument", id: "India:TCS", type: "stock", symbol: "TCS", exchange: "NSE", name: "Tata Consultancy Services", href: "/stock/TCS", start: 6, end: 10 };
const bseOnly: StoredMention = { ...sbin, id: "BSE:SBIN", exchange: "BSE", symbol: "SBIN.BSE", href: "/stock/SBIN.BSE" };
const nifty: StoredMention = { ...sbin, id: "index:NIFTY", type: "index", symbol: "NIFTY", name: "NIFTY 50", href: "/indices/NIFTY" };

const quote = (symbol: string, price: number, extra: Partial<AssetQuote> = {}): AssetQuote => ({ symbol, price, change: 10, changePercent: 1.25, currency: "INR", source: "Upstox", lastUpdated: "2026-10-28T09:45:00.000Z", ...extra });

function post(id: string, mentions: StoredMention[]): PostView {
  return {
    id,
    body: "@SBIN @TCS",
    sentiment: null,
    symbols: [],
    parentId: null,
    mentions,
    likeCount: 0,
    replyCount: 0,
    createdAt: "2026-10-28T08:00:00.000Z",
    author: { username: "a", displayName: "A", avatarUrl: null, role: "user", stats: { resolved: 0, wins: 0, points: 0 } },
  };
}

test("only listed NSE stocks are priced: not BSE tags, indices or other kinds", () => {
  assert.equal(quotableSymbol(sbin), "SBIN");
  assert.equal(quotableSymbol({ ...sbin, symbol: "SBIN.NS" }), "SBIN");
  assert.equal(quotableSymbol(bseOnly), null);
  assert.equal(quotableSymbol(nifty), null);
  assert.equal(quotableSymbol({ ...sbin, type: "etf" }), null);
  assert.equal(quotableSymbol({ kind: "ipo", ipoId: "x", communityId: "c", name: "X IPO", start: 0, end: 1 } as StoredMention), null);
});

test("a quote is used only if it is that symbol's and has a real price", () => {
  assert.equal(toStockQuote("SBIN", quote("TCS", 4000)), null);
  assert.equal(toStockQuote("SBIN", quote("SBIN", 0)), null);
  assert.equal(toStockQuote("SBIN", quote("SBIN", Number.NaN)), null);
  assert.equal(toStockQuote("SBIN", undefined), null);
  assert.deepEqual(toStockQuote("SBIN", quote("SBIN", 812.4, { changePercent: undefined })), {
    price: 812.4,
    change: 10,
    changePercent: null,
    currency: "INR",
    asOf: "2026-10-28T09:45:00.000Z",
    source: "Upstox",
  });
});

test("quotes are fetched in one batch, cached for a minute, and a failure isn't cached", async () => {
  let now = 0;
  const calls: string[][] = [];
  let fail = false;
  const quotes = quoteCache(
    async (symbols) => {
      calls.push(symbols);
      if (fail) throw new Error("provider down");
      return symbols.map((s) => quote(s, 100));
    },
    () => now
  );

  assert.deepEqual([...(await quotes(["SBIN", "TCS", "SBIN"])).keys()], ["SBIN", "TCS"]);
  assert.deepEqual(calls, [["SBIN", "TCS"]]);

  // Cached: no second call; a new symbol is fetched on its own.
  await quotes(["SBIN", "INFY"]);
  assert.deepEqual(calls, [["SBIN", "TCS"], ["INFY"]]);

  // A failed batch gives no prices and is retried next time.
  now += QUOTE_TTL_MS + 1;
  fail = true;
  assert.equal((await quotes(["SBIN"])).size, 0);
  fail = false;
  assert.equal((await quotes(["SBIN"])).get("SBIN")?.price, 100);
});

test("a slow provider never holds up the feed", async () => {
  const quotes = quoteCache(() => new Promise<AssetQuote[]>(() => {}), Date.now, 20);
  const started = Date.now();
  assert.equal((await quotes(["SBIN"])).size, 0);
  assert.ok(Date.now() - started < 1000);
});

test("a page of posts gets its prices from one batch, only on NSE stock tags", async () => {
  const batches: string[][] = [];
  const deps: ContextDeps = {
    communities: async () => [],
    ipoBoard: async () => ({ ok: false, error: "unused" }) as never,
    quotes: async (symbols) => {
      batches.push(symbols);
      return new Map([["SBIN", toStockQuote("SBIN", quote("SBIN", 812.4))!]]);
    },
  };
  const [first, second] = await attachContext([post("p1", [sbin, tcs]), post("p2", [sbin, bseOnly, nifty])], deps);
  assert.deepEqual(batches, [["SBIN", "TCS"]]);

  const priced = (p: PostView) => (p.context ?? []).map((c) => (c.kind === "instrument" ? [c.symbol, c.quote?.price ?? null] : null));
  // TCS had no verified quote, so it shows without a price.
  assert.deepEqual(priced(first), [["SBIN", 812.4], ["TCS", null]]);
  assert.deepEqual(priced(second), [["SBIN", 812.4], ["SBIN.BSE", null], ["NIFTY", null]]);
});

test("without a quote source, tags show as before", async () => {
  const [out] = await attachContext([post("p1", [sbin])], { communities: async () => [], ipoBoard: async () => ({ ok: false, error: "x" }) as never });
  assert.equal(out.context?.[0].kind === "instrument" && out.context[0].quote, undefined);
});

test("the tag reads as market data, with its source and time", () => {
  const view = formatQuote(toStockQuote("SBIN", quote("SBIN", 812.4))!);
  assert.equal(view.change, "+1.25%");
  assert.equal(view.tone, "up");
  assert.match(view.price, /812\.40/);
  assert.match(view.title, /Upstox.*IST\. Market data, not a member's opinion\./);
  assert.equal(formatQuote(toStockQuote("SBIN", quote("SBIN", 1, { changePercent: -0.5 }))!).tone, "down");
});
