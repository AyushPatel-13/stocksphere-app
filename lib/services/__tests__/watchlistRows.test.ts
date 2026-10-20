import { test } from "node:test";
import assert from "node:assert/strict";

import { fiftyTwoWeekRange, type History } from "../history";
import { MAX_WATCHLIST_SYMBOLS, getWatchlistRows, parseSymbolList, toWatchlistRow } from "../watchlistRows";
import { cleanListName, isMissingTable } from "../../watchlistRules";
import { GET } from "@/app/api/watchlist/rows/route";

function history(overrides: Partial<History> = {}): History {
  return {
    type: "stock",
    symbol: "TCS",
    name: "Tata Consultancy Services",
    unit: "currency",
    currency: "INR",
    range: "1d",
    interval: "1m",
    candles: [
      { t: 1, o: 100, h: 101, l: 99, c: 100, v: 1000 },
      { t: 2, o: 100, h: 103, l: 100, c: 102, v: 500 },
      { t: 3, o: 102, h: 104, l: 101, c: 103, v: null },
    ],
    previousClose: 100,
    fiftyTwoWeekHigh: 150,
    fiftyTwoWeekLow: 80,
    marketTime: "2026-10-19T10:00:00.000Z",
    sessionStart: null,
    sessionEnd: null,
    source: "Yahoo",
    ...overrides,
  };
}

test("a row carries the real price, change, summed volume, 52-week range and sparkline", () => {
  const row = toWatchlistRow("TCS", history());
  assert.equal(row.price, 103);
  assert.equal(row.change, 3);
  assert.equal(row.changePercent, 3);
  assert.equal(row.volume, 1500);
  assert.deepEqual([row.fiftyTwoWeekLow, row.fiftyTwoWeekHigh], [80, 150]);
  assert.deepEqual(row.spark, [100, 102, 103]);
  assert.equal(row.asOf, "2026-10-19T10:00:00.000Z");
  assert.equal(row.name, "Tata Consultancy Services");
});

test("missing values stay null — nothing is invented", () => {
  const empty = toWatchlistRow("ZZZ", null);
  assert.equal(empty.price, null);
  assert.deepEqual(empty.spark, []);

  const noPrev = toWatchlistRow("TCS", history({ previousClose: null }));
  assert.equal(noPrev.change, null);
  assert.equal(noPrev.changePercent, null);

  const noVolume = toWatchlistRow("TCS", history({ candles: [{ t: 1, o: 1, h: 1, l: 1, c: 5, v: null }] }));
  assert.equal(noVolume.volume, null);
});

test("symbol lists are validated, de-duplicated and capped", () => {
  assert.deepEqual(parseSymbolList("tcs, INFY,tcs,aapl"), ["TCS", "INFY", "AAPL"]);
  assert.equal(parseSymbolList(""), null);
  assert.equal(parseSymbolList(null), null);
  assert.equal(parseSymbolList("TCS,<script>"), null);
  assert.equal(parseSymbolList(Array.from({ length: MAX_WATCHLIST_SYMBOLS + 1 }, (_, i) => `S${i}`).join(",")), null);
});

test("rows keep the requested order and one failing symbol doesn't sink the rest", async () => {
  const rows = await getWatchlistRows(["TCS", "AAPL", "BAD"], async (asset) => {
    if (asset.symbol === "BAD") throw new Error("provider down");
    return history({ symbol: asset.symbol, name: asset.symbol });
  });
  assert.deepEqual(rows.map((r) => [r.symbol, r.price]), [["TCS", 103], ["AAPL", 103], ["BAD", null]]);
});

test("GET /api/watchlist/rows", async () => {
  const ok = await GET(new Request("http://x/api/watchlist/rows?symbols=TCS"), undefined, async (symbols) => symbols.map((s) => toWatchlistRow(s, history())));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).rows[0].price, 103);

  assert.equal((await GET(new Request("http://x/api/watchlist/rows"), undefined)).status, 400);
  assert.equal((await GET(new Request("http://x/api/watchlist/rows?symbols=%3Cx%3E"), undefined)).status, 400);

  const broken = await GET(new Request("http://x/api/watchlist/rows?symbols=TCS"), undefined, async () => {
    throw new Error("boom secret");
  });
  assert.equal(broken.status, 500);
  assert.doesNotMatch(await broken.text(), /secret/);
});

test("52-week range: provider figures first, then the extremes of the daily bars", () => {
  assert.deepEqual(fiftyTwoWeekRange(history()), { high: 150, low: 80 });
  assert.deepEqual(fiftyTwoWeekRange(history({ fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null })), { high: 104, low: 99 });
  assert.equal(fiftyTwoWeekRange(null), null);
  assert.equal(fiftyTwoWeekRange(history({ fiftyTwoWeekHigh: null, candles: [] })), null);
});

test("named lists: names are cleaned and a missing table means single-list mode", () => {
  assert.equal(cleanListName("  IT   stocks "), "IT stocks");
  assert.equal(cleanListName("   "), null);
  assert.equal(cleanListName("x".repeat(41)), null);
  assert.equal(isMissingTable({ code: "42P01" }), true);
  assert.equal(isMissingTable({ code: "PGRST205", message: "Could not find the table 'public.watchlists'" }), true);
  assert.equal(isMissingTable({ code: "42501", message: "permission denied" }), false);
  assert.equal(isMissingTable(null), false);
});
