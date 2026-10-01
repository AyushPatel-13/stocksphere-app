/**
 * Focused tests for /api/market's provider-error handling.
 *
 * The endpoint is asked to tell three different facts apart: a symbol that was
 * priced, a symbol its providers answered "no such symbol" for, and a symbol
 * nobody could answer for at all. Before this, getMarketQuote()'s null decided
 * all of them, so the third was reported as the second — a data source being
 * down was published as "No quote available for this symbol".
 *
 * That was not hypothetical. Yahoo is the chain's last resort, it fails
 * identically for a real symbol and an imaginary one (its own catch returns
 * null either way), and while these tests were written it was answering "Too
 * Many Requests" for every symbol the endpoint asked about. The endpoint had no
 * way to see that.
 *
 * Only globalThis.fetch is ever stubbed, and only for the two market-wide tests
 * whose Upstox leg would otherwise reach the network. The global chain is driven
 * through injected lookups instead — the arrangement
 * lib/providers/__tests__/marketQuote.test.ts uses, and the only one that can
 * reach Yahoo, which does not go through fetch at all.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  type TwelveQuoteLookup,
  type AlphaQuoteLookup,
  type YahooQuoteLookup,
} from "@/lib/providers/market.provider";
import type { AssetQuote } from "@/lib/types/quote";

import { GET } from "../route";

// ---------------------------------------------------------------------------
// Fixtures — each is field-for-field what the named client returns
// ---------------------------------------------------------------------------

/** A real TwelveData quote. `close` is what the chain tests for. */
function twelveQuoteFixture() {
  return {
    symbol: "AAPL",
    name: "Apple Inc",
    close: "331.51",
    previous_close: "338.40",
    open: "337.085",
    high: "337.12",
    low: "330.56",
    volume: "775228",
    currency: "USD",
  };
}

/** What TwelveData answers for a symbol it does not have. */
function twelveNotFound() {
  return {
    code: 400,
    message: "**symbol** not found: ZZZZ. Please check the symbol and try again.",
    status: "error",
  };
}

/** What TwelveData answers when the account cannot make the call. */
function twelveOutOfCredits() {
  return {
    code: 429,
    message: "You have run out of API credits for the current minute.",
    status: "error",
  };
}

/** A real Alpha Vantage GLOBAL_QUOTE response. */
function alphaQuoteFixture() {
  return {
    "Global Quote": {
      "01. symbol": "IBM",
      "02. open": "125.6300",
      "03. high": "126.3000",
      "04. low": "125.1000",
      "05. price": "125.7800",
      "06. volume": "3456789",
      "07. latest trading day": "2026-09-26",
      "08. previous close": "125.4000",
      "09. change": "0.3800",
      "10. change percent": "0.3031%",
    },
  };
}

/** What Alpha Vantage answers for a symbol it cannot resolve. */
function alphaEmptyEnvelope() {
  return { "Global Quote": {} };
}

/** What Alpha Vantage answers when it will not serve the request. */
function alphaQuotaNote() {
  return {
    Note: "Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day.",
  };
}

/** Field for field the shape getYahooQuote() returns. */
function yahooQuoteFixture() {
  return {
    price: 232.5,
    change: 1.2,
    changePercent: 0.52,
    currency: "USD",
    name: "Apple Inc.",
    open: 231,
    high: 233,
    low: 230.5,
    volume: 1234567,
    previousClose: 231.3,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type GlobalLookups = {
  twelve: TwelveQuoteLookup;
  alpha: AlphaQuoteLookup;
  yahoo: YahooQuoteLookup;
};

/** The three lookups replaced by recorders that answer with the fixtures. */
function lookups(
  options: {
    twelve?: unknown;
    alpha?: unknown;
    yahoo?: unknown;
    /** A provider that never answers at all. */
    unreachable?: "twelve" | "alpha" | "yahoo" | "all";
    calls?: string[];
  } = {}
): GlobalLookups {
  const record = (
    name: "twelve" | "alpha" | "yahoo"
  ): TwelveQuoteLookup => {
    return async (symbol: string) => {
      options.calls?.push(`${name}:${symbol}`);

      if (
        options.unreachable === name ||
        options.unreachable === "all"
      ) {
        throw new TypeError("fetch failed");
      }

      // Each fixture is stated as the shape its lookup returns — the fake is
      // deliberately loose (an empty Alpha envelope has almost no fields).
      return options[name] as Awaited<
        ReturnType<TwelveQuoteLookup>
      >;
    };
  };

  return {
    twelve: record("twelve"),
    alpha: record("alpha"),
    yahoo: record("yahoo"),
  } as GlobalLookups;
}

function requestFor(symbol?: string): Request {
  const url = new URL("http://localhost/api/market");

  if (symbol !== undefined) {
    url.searchParams.set("symbol", symbol);
  }

  return new Request(url);
}

/**
 * Run `fn` with the network and the console taken away.
 *
 * The Indian leg of the market-wide payload is not injectable — it goes through
 * getIndianMarketQuotes() to the real Upstox client — so stubbing fetch is how
 * "Upstox did not answer" is produced without a request. The console is
 * captured because lib/apis/upstox.ts and lib/apis/twelvedata.ts log on the way
 * through, and lib/apis/twelvedata.ts logs the API key it is configured with.
 * Nothing captured is asserted on or printed.
 */
async function withoutNetwork<T>(fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;

  globalThis.fetch = (async () => {
    throw new Error("network disabled in test");
  }) as typeof fetch;

  console.log = () => {};
  console.error = () => {};

  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  }
}

/**
 * Every failure answer carries exactly its documented fields, a non-empty safe
 * message, and no token, credential, upstream URL, upstream body or stack
 * trace.
 */
function assertSafeFailure(
  json: unknown,
  keys: string[],
  raw: string
): void {
  assert.deepEqual(
    Object.keys(json as object).sort(),
    [...keys].sort()
  );

  const failure = json as {
    success: boolean;
    error: string;
  };

  assert.equal(failure.success, false);
  assert.equal(typeof failure.error, "string");
  assert.ok(failure.error.trim().length > 0);

  assert.doesNotMatch(
    raw,
    /Bearer|UPSTOX|upstox\.com|twelvedata\.com|alphavantage\.co|apikey|api_key|credits|SyntaxError|TypeError|\.ts:\d/i
  );
}

const SINGLE_KEYS = ["error", "quote", "symbol", "success"];

// ---------------------------------------------------------------------------
// A resolved quote
// ---------------------------------------------------------------------------

test("a resolved global symbol is 200, and the body is unchanged", async () => {
  const calls: string[] = [];

  const response = await GET(
    requestFor("AAPL"),
    undefined,
    undefined,
    lookups({
      twelve: twelveQuoteFixture(),
      alpha: alphaQuoteFixture(),
      yahoo: yahooQuoteFixture(),
      calls,
    })
  );

  const json = (await response.json()) as {
    success: boolean;
    symbol: string;
    quote: { price: number; currency: string };
  };

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(json).sort(), [
    "quote",
    "success",
    "symbol",
  ]);
  assert.equal(json.success, true);
  assert.equal(json.symbol, "AAPL");
  assert.equal(json.quote.price, 331.51);
  assert.equal(json.quote.currency, "USD");

  // TwelveData is still primary, so nothing after it was consulted.
  assert.deepEqual(calls, ["twelve:AAPL"]);
});

// ---------------------------------------------------------------------------
// A symbol the providers answered "no such symbol" for
// ---------------------------------------------------------------------------

test("an unknown symbol is 404 — a definitive answer is not a failure", async () => {
  const calls: string[] = [];

  const response = await GET(
    requestFor("ZZZZ"),
    undefined,
    undefined,
    lookups({
      twelve: twelveNotFound(),
      alpha: alphaEmptyEnvelope(),
      yahoo: {},
      calls,
    })
  );

  const json: unknown = await response.json();

  assert.equal(response.status, 404);
  assert.notEqual(response.status, 503);
  assertSafeFailure(json, SINGLE_KEYS, JSON.stringify(json));

  // The chain was still walked in order, and no provider was short-circuited.
  assert.deepEqual(calls, [
    "twelve:ZZZZ",
    "alpha:ZZZZ",
    "yahoo:ZZZZ",
  ]);
});

test("an unknown symbol is still 404 when the last-resort provider is down", async () => {
  // This is the live situation while these tests were written: Yahoo was
  // answering "Too Many Requests" for every symbol. TwelveData and Alpha
  // Vantage both answered definitively, so the symbol is genuinely unknown and
  // calling it a 503 would be wrong — the one provider that failed had nothing
  // to add.
  const response = await GET(
    requestFor("ZZZZ"),
    undefined,
    undefined,
    lookups({
      twelve: twelveNotFound(),
      alpha: alphaEmptyEnvelope(),
      unreachable: "yahoo",
    })
  );

  assert.equal(response.status, 404);
  assert.notEqual(response.status, 503);
});

test("a provider failing does not turn an answered symbol into a 503", async () => {
  // TwelveData is unreachable, Alpha Vantage answers "no such symbol", Yahoo is
  // unreachable. Somebody answered, so the answer stands.
  const response = await GET(
    requestFor("ZZZZ"),
    undefined,
    undefined,
    lookups({
      alpha: alphaEmptyEnvelope(),
      unreachable: "twelve",
    })
  );

  assert.equal(response.status, 404);
});

// ---------------------------------------------------------------------------
// No provider answered
// ---------------------------------------------------------------------------

test("every provider unreachable is 503, never 404", async () => {
  const calls: string[] = [];

  const response = await GET(
    requestFor("ZZZZ"),
    undefined,
    undefined,
    lookups({ unreachable: "all", calls })
  );

  const json: unknown = await response.json();
  const raw = JSON.stringify(json);

  assert.equal(response.status, 503);
  assert.notEqual(response.status, 404);
  assert.notEqual(response.status, 200);
  assertSafeFailure(json, SINGLE_KEYS, raw);

  // Not one provider got through, and all three were still tried.
  assert.equal(calls.length, 3);
});

test("service-level errors are not answers: 503, not 404", async () => {
  // TwelveData is out of credits, Alpha Vantage is rate limited, Yahoo's client
  // threw. None of them said anything about this symbol.
  const response = await GET(
    requestFor("AAPL"),
    undefined,
    undefined,
    lookups({
      twelve: twelveOutOfCredits(),
      alpha: alphaQuotaNote(),
      yahoo: null,
    })
  );

  const json: unknown = await response.json();

  assert.equal(response.status, 503);
  assertSafeFailure(json, SINGLE_KEYS, JSON.stringify(json));
});

test("a malformed provider response is not an answer: 503, not 404", async () => {
  const response = await GET(
    requestFor("AAPL"),
    undefined,
    undefined,
    lookups({ twelve: {}, alpha: {}, yahoo: null })
  );

  assert.equal(response.status, 503);
});

// ---------------------------------------------------------------------------
// The fallback chain
// ---------------------------------------------------------------------------

test("TwelveData failing still falls through to Alpha Vantage", async () => {
  const calls: string[] = [];

  const response = await GET(
    requestFor("IBM"),
    undefined,
    undefined,
    lookups({
      alpha: alphaQuoteFixture(),
      yahoo: yahooQuoteFixture(),
      unreachable: "twelve",
      calls,
    })
  );

  const json = (await response.json()) as {
    quote: { price: number; symbol: string };
  };

  assert.equal(response.status, 200);
  assert.equal(json.quote.price, 125.78);
  assert.equal(json.quote.symbol, "IBM");

  // Alpha answered, so Yahoo was never reached — the order is unchanged.
  assert.deepEqual(calls, ["twelve:IBM", "alpha:IBM"]);
});

// ---------------------------------------------------------------------------
// Unexpected exception
// ---------------------------------------------------------------------------

test("an unexpected exception is 500, never 404 or 503", async () => {
  const response = await GET(
    requestFor("AAPL"),
    undefined,
    async () => {
      throw new Error("kaboom");
    }
  );

  const json: unknown = await response.json();

  assert.equal(response.status, 500);
  assert.notEqual(response.status, 503);
  assertSafeFailure(json, SINGLE_KEYS, JSON.stringify(json));
});

// ---------------------------------------------------------------------------
// The market-wide payload
// ---------------------------------------------------------------------------

test("a total outage is 503, and the payload shape is preserved", async () => {
  await withoutNetwork(async () => {
    const response = await GET(
      requestFor(),
      undefined,
      async () => null
    );

    const json = (await response.json()) as {
      success: boolean;
      us: Record<string, unknown>;
      india: unknown[];
      error: string;
    };

    assert.equal(response.status, 503);
    assert.notEqual(response.status, 200);
    assert.equal(json.success, false);
    assert.deepEqual(Object.keys(json).sort(), [
      "error",
      "india",
      "success",
      "us",
    ]);
    assert.deepEqual(Object.keys(json.us).sort(), [
      "apple",
      "microsoft",
      "nvidia",
      "tesla",
    ]);
    assert.equal(json.india.length, 0);

    assertSafeFailure(
      json,
      ["error", "india", "success", "us"],
      JSON.stringify(json)
    );
  });
});

test("the market-wide payload is still 200 with the same shape", async () => {
  const quote: AssetQuote = {
    symbol: "AAPL",
    price: 331.51,
    currency: "USD",
  };

  await withoutNetwork(async () => {
    const response = await GET(
      requestFor(),
      undefined,
      async () => quote
    );

    const json = (await response.json()) as {
      success: boolean;
      us: Record<string, { price: number }>;
      india: unknown[];
    };

    // Upstox is unreachable in this test, so the Indian half is empty — and
    // that on its own is a partial answer, not a failure. The global half is
    // intact and the caller is told the truth about the rest.
    assert.equal(response.status, 200);
    assert.equal(json.success, true);
    assert.deepEqual(Object.keys(json).sort(), [
      "india",
      "success",
      "us",
    ]);
    assert.deepEqual(Object.keys(json.us).sort(), [
      "apple",
      "microsoft",
      "nvidia",
      "tesla",
    ]);
    assert.equal(json.us.apple.price, 331.51);
  });
});
