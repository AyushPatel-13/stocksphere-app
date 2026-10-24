import { test } from "node:test";
import assert from "node:assert/strict";

import { runMarketQuotes, marketQuotesTool, type MarketQuotesDeps } from "../marketQuotesTool";
import { runIpoTool, ipoTool } from "../ipoTool";
import { appGuideTool, APP_GUIDE } from "../appGuideTool";
import type { IndicesSnapshot, LiveIndex } from "@/lib/services/indices";
import type { AssetBoard, BoardItem } from "@/lib/services/assetBoard";
import type { IpoBoardResult, IpoRow } from "@/lib/services/ipo";

const index = (symbol: string, name: string, price: number | null, changePercent: number | null): LiveIndex =>
  ({ symbol, name, category: "indian", instrumentKey: "", source: "Upstox", price, change: null, changePercent, open: null, high: null, low: null, previousClose: null, lastUpdated: "2026-10-21T10:00:00.000Z" }) as LiveIndex;

const item = (symbol: string, name: string, price: number | null, unit: BoardItem["unit"] = "currency"): BoardItem =>
  ({ symbol, name, price, change: 1, changePercent: 0.123456, marketTime: "2026-10-21T10:00:00.000Z", region: "us", currency: "USD", unit, group: "x" }) as BoardItem;

function deps(over: Partial<MarketQuotesDeps> = {}): MarketQuotesDeps {
  return {
    indices: async (): Promise<IndicesSnapshot> => ({
      indices: [index("NIFTY", "NIFTY 50", 25012.345, 0.42), index("NIFTYIT", "NIFTY IT", 35000, -1.2), index("SPX", "S&P 500", 6700, 0.1)],
      unavailable: [],
      fetchedAt: "2026-10-21T10:00:01.000Z",
    }),
    board: async (type, vs): Promise<AssetBoard> => ({
      type,
      vs,
      items: type === "bond" ? [item("US10Y", "US 10-year Treasury yield", 4.12, "percent")] : [item("BTC", "Bitcoin", 101234.567), item("ETH", "Ethereum", null)],
      fetchedAt: "2026-10-21T10:00:01.000Z",
    }),
    ...over,
  };
}

test("market quotes: index names and aliases are matched, untracked ones reported", async () => {
  const r = (await runMarketQuotes({ kind: "indices", symbols: ["Nifty 50", "S&P 500", "nifty it", "Russell 2000"] }, deps()))!;
  assert.deepEqual(r.quotes.map((q) => q.symbol), ["NIFTY", "NIFTYIT", "SPX"]);
  assert.equal(r.quotes[0].price, 25012.35);
  assert.deepEqual(r.notCovered, ["Russell 2000"]);
});

test("market quotes: crypto by name; a missing price stays null; yields carry no currency", async () => {
  const c = (await runMarketQuotes({ kind: "crypto", symbols: ["bitcoin", "ETH"] }, deps()))!;
  assert.equal(c.quotes[0].price, 101234.57);
  assert.equal(c.quotes[0].changePercent, 0.12);
  assert.equal(c.quotes[1].price, null);
  const b = (await runMarketQuotes({ kind: "bond", symbols: ["10-year"] }, deps()))!;
  assert.equal(b.quotes[0].symbol, "US10Y");
  assert.equal(b.quotes[0].unit, "percent");
  assert.equal(b.quotes[0].currency, null);
});

test("market quotes: a board with no prices at all is an outage, not zeros", async () => {
  const outage = deps({ board: async (type, vs) => ({ type, vs, items: [item("BTC", "Bitcoin", null)], fetchedAt: "" }) });
  assert.equal(await runMarketQuotes({ kind: "crypto" }, outage), null);
  assert.equal(marketQuotesTool.argsSchema.safeParse({ kind: "stocks" }).success, false);
});

const ipo = (name: string, section: IpoRow["section"], board: IpoRow["board"] = "mainboard"): IpoRow =>
  ({
    id: name, symbol: name.toUpperCase(), name, isin: null, board, industry: null, providerStatus: null, section, listingState: null,
    openDate: "2026-10-21", closeDate: "2026-10-23", dailyStartTime: null, dailyEndTime: null, priceBand: { low: 100, high: 105 }, cutOffPrice: 105,
    faceValue: 10, lotSize: 142, minimumQuantity: 142, minInvestment: 14910, issueSizeCr: 500, subscription: null, demand: { level: "not-open", label: "", basis: "" },
    timeline: { allotmentDate: "2026-10-24", refundDate: null, listingDate: "2026-10-28", mandateEndDate: null }, listingExchanges: ["NSE"], listingPrice: null,
    listingGainPct: null, session: null, rhpUrl: null, drhpUrl: null, gmp: null, detailOk: true,
  }) as IpoRow;

const board = (rows: IpoRow[]): IpoBoardResult =>
  ({ ok: true, data: { ipos: rows, unclassified: [], today: "2026-10-21", generatedAt: "", staleReason: null, gmp: {} as never, sources: [] } }) as IpoBoardResult;

test("ipos: filtered by section, board and name, with the fields an answer needs", async () => {
  const load = async () => board([ipo("Jio Financial", "open"), ipo("Paras SME", "open", "sme"), ipo("Later Ltd", "upcoming")]);
  const open = (await runIpoTool({ section: "open", board: "mainboard" }, load))!;
  assert.deepEqual(open.ipos.map((i) => i.name), ["Jio Financial"]);
  assert.equal(open.ipos[0].priceBand, "₹100–₹105");
  assert.equal(open.ipos[0].listingDate, "2026-10-28");
  assert.equal(open.ipos[0].subscriptionTimes, null);
  assert.match(open.notes.join(" "), /GMP/);
  const named = (await runIpoTool({ name: "later" }, load))!;
  assert.equal(named.totalMatching, 1);
});

test("ipos: an Upstox failure is reported as unavailable", async () => {
  assert.equal(await runIpoTool({}, async () => ({ ok: false, code: "auth", message: "x" }) as IpoBoardResult), null);
  assert.equal(ipoTool.argsSchema.safeParse({ section: "live" }).success, false);
});

test("app help: a topic returns its entry; no topic returns the whole guide", async () => {
  const one = await appGuideTool.execute({ topic: "watchlist" });
  assert.ok(one.ok);
  assert.match(JSON.stringify(one.data), /Add to Watchlist/);
  const all = await appGuideTool.execute({});
  assert.equal(Object.keys((all.data as { guide: object }).guide).length, Object.keys(APP_GUIDE).length);
  assert.equal(appGuideTool.argsSchema.safeParse({ topic: "taxes" }).success, false);
});
