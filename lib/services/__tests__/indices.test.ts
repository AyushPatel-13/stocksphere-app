import { INDIAN_INDEX_YAHOO } from "../../data/assets";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GLOBAL_INDICES,
  INDIAN_INDICES,
} from "@/lib/data/instruments/indices";
import {
  createIndicesLoader,
  mapUpstoxIndices,
  type IndicesDeps,
} from "../indices";
import { GET } from "@/app/api/indices/route";

// The indices snapshot is tested with fake providers: no Upstox token, no
// Yahoo reachability, no network. The rules under test are the ones the pages
// rely on — which provider prices which market, what an outage looks like,
// and when a snapshot is reused.

type UpstoxFake = IndicesDeps["getUpstoxQuotes"];
type YahooFake = IndicesDeps["getYahooQuotes"];
const INDIAN_YAHOO = new Set(Object.values(INDIAN_INDEX_YAHOO));

/** A batch answer holding every requested symbol at one price. */
function yahooBatch(symbols: string[], price = 100) {
  return Object.fromEntries(symbols.map((symbol) => [symbol, yahooQuote(price)]));
}

/** An Upstox full-quote response holding one entry per given instrument key. */
function upstoxResponse(keys: string[]) {
  return {
    status: "success",
    data: Object.fromEntries(
      keys.map((key, position) => [
        key.replace("|", ":"),
        {
          instrument_token: key,
          last_price: 1000 + position,
          net_change: 10,
          ohlc: { open: 990, high: 1010, low: 980, close: 1000 + position },
          timestamp: "2026-10-16T10:00:00.000+05:30",
        },
      ])
    ),
  };
}

function yahooQuote(price: number) {
  return {
    price,
    change: -5,
    changePercent: -0.5,
    currency: "USD",
    name: "Index",
    open: price + 1,
    high: price + 2,
    low: price - 2,
    volume: 0,
    previousClose: price + 5,
  };
}

function deps(overrides: Partial<IndicesDeps> = {}): IndicesDeps {
  return {
    getUpstoxQuotes: (async (keys: string[]) =>
      upstoxResponse(keys)) as UpstoxFake,
    getYahooQuotes: (async (symbols: string[]) =>
      yahooBatch(symbols)) as YahooFake,
    now: () => 0,
    ...overrides,
  };
}

test("Upstox is asked only for Indian instrument keys, never global tickers", async () => {
  let requested: string[] = [];

  const load = createIndicesLoader(
    deps({
      getUpstoxQuotes: (async (keys: string[]) => {
        requested = keys;
        return upstoxResponse(keys);
      }) as UpstoxFake,
    })
  );

  await load();

  assert.deepEqual(
    requested,
    INDIAN_INDICES.map((index) => index.instrumentKey)
  );
  assert.ok(requested.every((key) => /^(NSE|BSE)_INDEX\|/.test(key)));
});

test("global indices are priced from ONE Yahoo request, by Yahoo ticker", async () => {
  const asked: string[] = [];
  let requests = 0;

  const load = createIndicesLoader(
    deps({
      getYahooQuotes: (async (symbols: string[]) => {
        requests++;
        asked.push(...symbols);
        return yahooBatch(symbols);
      }) as YahooFake,
    })
  );

  const snapshot = await load();
  const global = snapshot.indices.filter((index) => index.category === "global");

  assert.deepEqual(
    asked.sort(),
    GLOBAL_INDICES.map((index) => index.yahooSymbol).sort()
  );
  assert.equal(requests, 1);
  assert.ok(global.every((index) => index.source === "Yahoo"));
  assert.ok(global.every((index) => index.price === 100));
  assert.deepEqual(snapshot.unavailable, []);
});

test("Upstox entries are matched on instrument_token, and percent follows from previous close", () => {
  const [nifty] = mapUpstoxIndices(
    upstoxResponse([INDIAN_INDICES[0].instrumentKey]),
    INDIAN_INDICES
  );

  assert.equal(nifty.symbol, "NIFTY");
  assert.equal(nifty.price, 1000);
  assert.equal(nifty.change, 10);
  // No prev_close_price in the response: price - change.
  assert.equal(nifty.previousClose, 990);
  assert.ok(Math.abs((nifty.changePercent ?? 0) - (10 / 990) * 100) < 1e-9);
  assert.equal(nifty.high, 1010);
});

test("an index missing from the Upstox response is unavailable, not zero", () => {
  const mapped = mapUpstoxIndices(
    upstoxResponse([INDIAN_INDICES[0].instrumentKey]),
    INDIAN_INDICES
  );

  const sensex = mapped.find((index) => index.symbol === "SENSEX");

  assert.equal(sensex?.price, null);
  assert.equal(sensex?.change, null);
  assert.equal(sensex?.changePercent, null);
});

test("a missing change is reported as null percent, never 0%", () => {
  const key = INDIAN_INDICES[0].instrumentKey;

  const [nifty] = mapUpstoxIndices(
    { data: { x: { instrument_token: key, last_price: 1000 } } },
    INDIAN_INDICES
  );

  assert.equal(nifty.price, 1000);
  assert.equal(nifty.change, null);
  assert.equal(nifty.changePercent, null);
});

test("a Yahoo refusal (429) leaves Indian indices intact and names the global market unavailable", async () => {
  const load = createIndicesLoader(
    deps({ getYahooQuotes: (async () => null) as YahooFake })
  );

  const snapshot = await load();

  assert.deepEqual(snapshot.unavailable, ["global"]);
  assert.ok(
    snapshot.indices
      .filter((index) => index.category === "indian")
      .every((index) => index.price !== null)
  );
});

test("an Upstox outage with no Yahoo fallback leaves global indices intact and names the Indian market unavailable", async () => {
  const load = createIndicesLoader(
    deps({
      getUpstoxQuotes: (async () => {
        throw new Error("UPSTOX_ACCESS_TOKEN is missing");
      }) as UpstoxFake,
      // Yahoo answers for global tickers only: the Indian fallback finds nothing.
      getYahooQuotes: (async (symbols: string[]) => yahooBatch(symbols.filter((symbol) => !INDIAN_YAHOO.has(symbol)))) as YahooFake,
    })
  );

  const snapshot = await load();

  assert.deepEqual(snapshot.unavailable, ["indian"]);
  assert.ok(
    snapshot.indices
      .filter((index) => index.category === "global")
      .every((index) => index.price !== null)
  );
});

test("a ticker missing from the Yahoo answer is unavailable; the rest still price", async () => {
  const load = createIndicesLoader(
    deps({
      getYahooQuotes: (async (symbols: string[]) =>
        yahooBatch(symbols.filter((symbol) => symbol !== "^N225"))) as YahooFake,
    })
  );

  const snapshot = await load();
  const nikkei = snapshot.indices.find((index) => index.symbol === "NIKKEI");
  const dow = snapshot.indices.find((index) => index.symbol === "DOW");

  assert.equal(nikkei?.price, null);
  assert.equal(dow?.price, 100);
  assert.deepEqual(snapshot.unavailable, []);
});

test("a snapshot is reused within the TTL and refreshed after it", async () => {
  let clock = 0;
  let upstoxCalls = 0;

  const load = createIndicesLoader(
    deps({
      now: () => clock,
      getUpstoxQuotes: (async (keys: string[]) => {
        upstoxCalls++;
        return upstoxResponse(keys);
      }) as UpstoxFake,
    }),
    30_000
  );

  await load();
  clock = 29_999;
  await load();
  assert.equal(upstoxCalls, 1);

  clock = 30_000;
  await load();
  assert.equal(upstoxCalls, 2);
});

test("concurrent callers share one in-flight load", async () => {
  let upstoxCalls = 0;

  const load = createIndicesLoader(
    deps({
      getUpstoxQuotes: (async (keys: string[]) => {
        upstoxCalls++;
        return upstoxResponse(keys);
      }) as UpstoxFake,
    })
  );

  await Promise.all([load(), load(), load()]);

  assert.equal(upstoxCalls, 1);
});

test("a total outage is not cached, so the next request retries", async () => {
  let upstoxCalls = 0;

  const load = createIndicesLoader(
    deps({
      getUpstoxQuotes: (async () => {
        upstoxCalls++;
        return null;
      }) as UpstoxFake,
      getYahooQuotes: (async () => null) as YahooFake,
    })
  );

  const first = await load();
  await load();

  assert.deepEqual(first.unavailable, ["indian", "global"]);
  assert.equal(upstoxCalls, 2);
});

test("/api/indices answers 503 for a total outage and 200 for a partial one", async () => {
  const outage = createIndicesLoader(
    deps({
      getUpstoxQuotes: (async () => null) as UpstoxFake,
      getYahooQuotes: (async () => null) as YahooFake,
    })
  );

  const down = await GET(undefined, undefined, outage);
  assert.equal(down.status, 503);
  assert.equal((await down.json()).success, false);

  const partial = createIndicesLoader(
    deps({ getUpstoxQuotes: (async () => null) as UpstoxFake, getYahooQuotes: (async (symbols: string[]) => yahooBatch(symbols.filter((symbol) => !INDIAN_YAHOO.has(symbol)))) as YahooFake })
  );

  const up = await GET(undefined, undefined, partial);
  const body = await up.json();

  assert.equal(up.status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.unavailable, ["indian"]);
});

test("/api/indices answers 500 when the loader throws", async () => {
  const response = await GET(undefined, undefined, async () => {
    throw new Error("unexpected");
  });

  assert.equal(response.status, 500);
  assert.equal((await response.json()).success, false);
});

// --- Yahoo chart parsing (lib/apis/yahooChart.ts) ---------------------------

import { parseChartQuote } from "@/lib/apis/yahooChart";

function chartBody(meta: Record<string, unknown>, opens: unknown[] = [7745.3]) {
  return {
    chart: {
      result: [{ meta, indicators: { quote: [{ open: opens }] } }],
      error: null,
    },
  };
}

test("a chart response becomes a quote: change from the previous close, open from the bar", () => {
  const quote = parseChartQuote(
    chartBody({
      regularMarketPrice: 7659.44,
      chartPreviousClose: 7744.06,
      regularMarketDayHigh: 7756.84,
      regularMarketDayLow: 7631.77,
      regularMarketTime: 1792182128,
      currency: "USD",
    })
  );

  assert.ok(quote);
  assert.equal(quote.price, 7659.44);
  assert.ok(Math.abs((quote.change ?? 0) - (7659.44 - 7744.06)) < 1e-9);
  assert.ok(Math.abs((quote.changePercent ?? 0) - ((7659.44 - 7744.06) / 7744.06) * 100) < 1e-9);
  assert.equal(quote.open, 7745.3);
  assert.equal(quote.high, 7756.84);
  assert.equal(quote.currency, "USD");
  assert.equal(quote.marketTime, new Date(1792182128 * 1000).toISOString());
});

test("a chart response with no price, or Yahoo's error envelope, is no quote", () => {
  assert.equal(parseChartQuote(chartBody({ chartPreviousClose: 100 })), null);
  assert.equal(parseChartQuote({ chart: { result: null, error: { code: "Not Found" } } }), null);
  assert.equal(parseChartQuote("Too Many Requests"), null);
});

test("a missing previous close leaves change unknown rather than zero", () => {
  const quote = parseChartQuote(chartBody({ regularMarketPrice: 100 }));
  assert.equal(quote?.change, null);
  assert.equal(quote?.changePercent, null);
});

test("a global index carries Yahoo's market time as lastUpdated", async () => {
  const load = createIndicesLoader(
    deps({
      getYahooQuotes: (async (symbols: string[]) =>
        Object.fromEntries(
          symbols.map((symbol) => [symbol, { price: 100, marketTime: "2026-10-16T20:00:00.000Z" }])
        )) as YahooFake,
    })
  );

  const snapshot = await load();
  const spx = snapshot.indices.find((index) => index.symbol === "SPX");

  assert.equal(spx?.lastUpdated, "2026-10-16T20:00:00.000Z");
});

test("an expired Upstox token: Indian indices are priced from Yahoo for the same index, labelled Yahoo", async () => {
  const asked: string[][] = [];
  const load = createIndicesLoader(
    deps({
      getUpstoxQuotes: (async () => {
        throw new Error("UPSTOX_ACCESS_TOKEN is missing");
      }) as UpstoxFake,
      getYahooQuotes: (async (symbols: string[]) => {
        asked.push(symbols);
        return yahooBatch(symbols);
      }) as YahooFake,
    })
  );

  const snapshot = await load();
  const nifty = snapshot.indices.find((index) => index.symbol === "NIFTY");
  assert.equal(nifty?.source, "Yahoo");
  assert.notEqual(nifty?.price, null);
  assert.equal(nifty?.name, "NIFTY 50");
  assert.ok(asked.some((batch) => batch.includes("^NSEI")));
  assert.deepEqual(snapshot.unavailable, []);
});
