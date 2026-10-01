/**
 * Focused tests for /api/market/movers.
 *
 * They run the real route handler through the real provider chain
 * (getNifty50Quotes → getIndianMarketQuotes → Upstox) and stub only
 * globalThis.fetch — the arrangement lib/providers/__tests__ already uses.
 *
 * UPSTOX_ACCESS_TOKEN is assigned on the first executable line, before the
 * route is imported, because lib/apis/upstox.ts reads it into a module-level
 * const at import time: a value set after that point is ignored and every
 * instrument search throws instead. The two static imports below do not touch
 * the environment, and the route is imported dynamically inside each test, so
 * the assignment has always run by the time it loads.
 */
process.env.UPSTOX_ACCESS_TOKEN = "test-token-not-a-real-secret";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NIFTY_50_SYMBOLS,
  bareIndianSymbol,
} from "@/lib/data/instruments/india";

type Mover = {
  symbol: string;
  price: number;
  changePercent?: number;
};

type MoversSuccess = {
  success: true;
  universe: string;
  totalStocks: number;
  advancing: number;
  declining: number;
  unchanged: number;
  direction: string;
  breadthPercent: number;
  gainers: Mover[];
  losers: Mover[];
};

type MoversFailure = {
  success: false;
  error: string;
};

const PREV_CLOSE = 100;
const ADVANCERS = 3;
const DECLINERS = 2;

/**
 * The change applied to the symbol at `index`: walking back from the end, the
 * last three symbols advance by +1, +2 and +3 — so the strongest gainer is the
 * third from last — the first two decline by -1 and -2, and every other symbol
 * is flat. With `prev_close_price` fixed, the adapter's changePercent is the
 * change itself, so the expected breadth, direction and top-three ordering
 * follow from ADVANCERS/DECLINERS alone — not from how many symbols the
 * universe happens to hold.
 */
function changeFor(index: number): number {
  const fromEnd = NIFTY_50_SYMBOLS.length - index;

  if (fromEnd <= ADVANCERS) return fromEnd;

  if (index < DECLINERS) return -(index + 1);

  return 0;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** A 200 whose body is not JSON at all: the shape upstream proxies answer
 *  with when they fail, and something `response.json()` throws on. */
function unparseableResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON at position 0");
    },
    text: async () => "<html>upstream proxy error</html>",
  } as unknown as Response;
}

function instrumentSearchResponse(query: string): Response {
  const bare = bareIndianSymbol(query);

  return jsonResponse({
    data: [
      {
        segment: "NSE_EQ",
        instrument_type: "EQ",
        trading_symbol: bare,
        instrument_key: `NSE_EQ|${bare}`,
      },
    ],
  });
}

/**
 * The bulk quote payload for the whole NIFTY 50 universe (see changeFor).
 *
 * `omit` drops a row, which is how a partial provider answer is produced.
 */
function bulkQuotesBody(omit: number[] = []): {
  data: Record<string, unknown>;
} {
  const data: Record<string, unknown> = {};

  NIFTY_50_SYMBOLS.forEach((symbol, index) => {
    if (omit.includes(index)) return;

    const change = changeFor(index);

    data[`NSE_EQ:${symbol}`] = {
      instrument_token: `NSE_EQ|${symbol}`,
      symbol,
      last_price: PREV_CLOSE + change,
      prev_close_price: PREV_CLOSE,
      net_change: change,
      volume: 1000,
      ohlc: {
        open: PREV_CLOSE,
        high: PREV_CLOSE + 1,
        low: PREV_CLOSE - 1,
      },
    };
  });

  return { data };
}

type FetchHandler = (url: string) => Response;

/** Search resolves for every symbol; the bulk quote call decides the case. */
function searchThen(quotes: FetchHandler): FetchHandler {
  return (url) =>
    url.includes("/instruments/search")
      ? instrumentSearchResponse(
          new URL(url).searchParams.get("query") ?? ""
        )
      : quotes(url);
}

function installFetch(handler: FetchHandler): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: unknown) =>
    handler(String(input))) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

function loadGet() {
  return import("../movers/route").then((route) => route.GET);
}

/**
 * Every failure answer is exactly { success: false, error }, with a non-empty
 * safe message and no token, upstream URL, upstream body or stack trace
 * anywhere in the serialized payload.
 */
function assertSafeFailure(json: unknown, raw: string): void {
  assert.deepEqual(
    Object.keys(json as object).sort(),
    ["error", "success"]
  );

  const failure = json as MoversFailure;

  assert.equal(failure.success, false);
  assert.equal(typeof failure.error, "string");
  assert.ok(failure.error.trim().length > 0);

  assert.doesNotMatch(
    raw,
    /Bearer|UPSTOX|upstox\.com|test-token|SyntaxError|TypeError|\.ts:\d/
  );
}

test("success: 200 with the movers payload, unchanged in shape", async () => {
  const restore = installFetch(
    searchThen(() => jsonResponse(bulkQuotesBody()))
  );

  try {
    const GET = await loadGet();
    const response = await GET();
    const json = (await response.json()) as MoversSuccess;

    assert.equal(response.status, 200);
    assert.equal(json.success, true);

    // The successful response shape is the contract the Home page reads:
    // these ten fields, none added, none removed.
    assert.deepEqual(Object.keys(json).sort(), [
      "advancing",
      "breadthPercent",
      "declining",
      "direction",
      "gainers",
      "losers",
      "success",
      "totalStocks",
      "unchanged",
      "universe",
    ]);

    assert.equal(json.universe, "NIFTY_50");
    assert.equal(json.totalStocks, NIFTY_50_SYMBOLS.length);
    assert.equal(json.advancing, ADVANCERS);
    assert.equal(json.declining, DECLINERS);
    assert.equal(
      json.unchanged,
      NIFTY_50_SYMBOLS.length - ADVANCERS - DECLINERS
    );
    assert.equal(
      json.breadthPercent,
      (ADVANCERS / NIFTY_50_SYMBOLS.length) * 100
    );
    assert.equal(json.direction, "BULLISH");

    assert.equal(json.gainers.length, ADVANCERS);
    assert.equal(json.losers.length, DECLINERS);

    // Top three gainers, strongest first; top two losers, weakest first.
    assert.deepEqual(
      json.gainers.map((mover) => mover.symbol),
      [
        NIFTY_50_SYMBOLS[NIFTY_50_SYMBOLS.length - 3],
        NIFTY_50_SYMBOLS[NIFTY_50_SYMBOLS.length - 2],
        NIFTY_50_SYMBOLS[NIFTY_50_SYMBOLS.length - 1],
      ]
    );

    assert.deepEqual(
      json.losers.map((mover) => mover.symbol),
      [NIFTY_50_SYMBOLS[1], NIFTY_50_SYMBOLS[0]]
    );

    assert.ok(
      json.gainers[0].changePercent! >
        json.gainers[1].changePercent!
    );
    assert.ok(
      json.losers[0].changePercent! <
        json.losers[1].changePercent!
    );
  } finally {
    restore();
  }
});

test("provider failure: an upstream error is a 503, never 200", async () => {
  const restore = installFetch(
    searchThen(() =>
      jsonResponse({ status: "error" }, 500)
    )
  );

  try {
    const GET = await loadGet();
    const response = await GET();
    const json: unknown = await response.json();

    assert.equal(response.status, 503);
    assert.notEqual(response.status, 200);
    assertSafeFailure(json, JSON.stringify(json));
  } finally {
    restore();
  }
});

test("provider failure: an upstream 401 is a 503", async () => {
  const restore = installFetch(
    searchThen(() =>
      jsonResponse(
        {
          status: "error",
          errors: [
            {
              errorCode: "UDAPI100050",
              message: "Invalid token used to access API",
            },
          ],
        },
        401
      )
    )
  );

  try {
    const GET = await loadGet();
    const response = await GET();
    const json: unknown = await response.json();

    assert.equal(response.status, 503);
    assertSafeFailure(json, JSON.stringify(json));
  } finally {
    restore();
  }
});

test("provider failure: a transport error is a 503", async () => {
  const restore = installFetch(
    searchThen(() => {
      throw new TypeError("fetch failed");
    })
  );

  try {
    const GET = await loadGet();
    const response = await GET();
    const json: unknown = await response.json();

    assert.equal(response.status, 503);
    assertSafeFailure(json, JSON.stringify(json));
  } finally {
    restore();
  }
});

test("invalid data: a malformed provider response is a 503", async () => {
  const restore = installFetch(
    searchThen(() => unparseableResponse())
  );

  try {
    const GET = await loadGet();
    const response = await GET();
    const json: unknown = await response.json();

    assert.equal(response.status, 503);
    assertSafeFailure(json, JSON.stringify(json));
  } finally {
    restore();
  }
});

test("partial data is not a failure: one symbol short still answers 200", async () => {
  // Index 0 is a decliner, so the answer is one decliner short of complete.
  const restore = installFetch(
    searchThen(() =>
      jsonResponse(bulkQuotesBody([0]))
    )
  );

  try {
    const GET = await loadGet();
    const response = await GET();
    const json = (await response.json()) as MoversSuccess;

    assert.equal(response.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.totalStocks, NIFTY_50_SYMBOLS.length - 1);
    assert.equal(
      json.advancing + json.declining + json.unchanged,
      NIFTY_50_SYMBOLS.length - 1
    );
  } finally {
    restore();
  }
});

test("unexpected exception: a throwing provider is a 500, never 200", async () => {
  const GET = await loadGet();

  const response = await GET(
    undefined,
    undefined,
    async () => {
      throw new Error("kaboom");
    }
  );

  const json: unknown = await response.json();

  assert.equal(response.status, 500);
  assert.notEqual(response.status, 200);
  assertSafeFailure(json, JSON.stringify(json));
});
