import { test } from "node:test";
import assert from "node:assert/strict";

import { fromAlphaVantage, fromUpstox } from "@/lib/adapters/quote.adapter";
import {
  getMarketQuote,
  type TwelveQuoteLookup,
  type AlphaQuoteLookup,
  type YahooQuoteLookup,
} from "@/lib/providers/market.provider";

/**
 * A symbol nobody can price must come back as null, never as a quote of zero.
 *
 * The defect these tests pin down:
 *
 *   getMarketQuote("ZZZZ")  ->  { symbol: "", price: 0, change: 0, ... }
 *
 * Alpha Vantage answers a symbol it cannot resolve with `{"Global Quote": {}}`
 * — a valid envelope with nothing in it. market.provider.ts tested only that
 * the key was present, and an empty object is truthy, so fromAlphaVantage() ran
 * on nothing and `Number(undefined ?? 0)` produced a price of 0. Every caller
 * then reported a fabrication as if it were a quote: the agent's price tool
 * would say a symbol trades at zero.
 *
 * The two halves are tested separately because they fail differently. The
 * adapter tests are pure. The provider tests inject all three global lookups,
 * which is not just convenience: the chain's last provider is Yahoo, reached
 * through the yahoo-finance2 client rather than fetch, so stubbing the network
 * cannot intercept it — without injectable lookups, testing the fallback order
 * would mean making real requests to Yahoo.
 */

// ---------------------------------------------------------------------------
// Fixtures — each is field-for-field what the named client returns
// ---------------------------------------------------------------------------

/** What Alpha Vantage answers for a symbol it cannot resolve. */
function alphaEmptyEnvelope() {
  return { "Global Quote": {} };
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

/** Field for field the shape getStockQuote() (TwelveData) returns. */
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

/**
 * Recorders. Each is annotated with its lookup type and casts the fixture
 * through, which is how price.test.ts types its fakes — the fixtures are
 * deliberately loose (an empty Alpha envelope has almost no fields), so they
 * are stated as the shape the lookup returns rather than the shape they are.
 */
function recorders(
  options: {
    twelve?: unknown;
    alpha?: unknown;
    yahoo?: unknown;
  },
  calls: string[]
) {
  const twelve: TwelveQuoteLookup = async (symbol: string) => {
    calls.push(`twelve:${symbol}`);

    return options.twelve as Awaited<ReturnType<TwelveQuoteLookup>>;
  };

  const alpha: AlphaQuoteLookup = async (symbol: string) => {
    calls.push(`alpha:${symbol}`);

    return options.alpha as Awaited<ReturnType<AlphaQuoteLookup>>;
  };

  const yahoo: YahooQuoteLookup = async (symbol: string) => {
    calls.push(`yahoo:${symbol}`);

    return options.yahoo as Awaited<ReturnType<YahooQuoteLookup>>;
  };

  return { twelve, alpha, yahoo };
}

/** Run getMarketQuote with all three global lookups replaced by recorders. */
function withProviders(
  options: {
    twelve?: unknown;
    alpha?: unknown;
    yahoo?: unknown;
  } = {}
) {
  const calls: string[] = [];
  const { twelve, alpha, yahoo } = recorders(options, calls);

  return {
    calls,
    run: (symbol: string) =>
      getMarketQuote(symbol, twelve, alpha, yahoo),
  };
}

// ---------------------------------------------------------------------------
// The adapter: an absent price is null, not zero
// ---------------------------------------------------------------------------

test("alpha adapter: an empty Global Quote is null, not a quote of zero", () => {
  // The exact response that produced the fabricated quote.
  const result = fromAlphaVantage(alphaEmptyEnvelope());

  assert.equal(result, null);
});

test("alpha adapter: a Global Quote carrying no price field is null", () => {
  const result = fromAlphaVantage({
    "Global Quote": { "01. symbol": "ZZZZ", "09. change": "0.0000" },
  });

  assert.equal(result, null);
});

test("alpha adapter: a response with no Global Quote key at all is null", () => {
  assert.equal(fromAlphaVantage({}), null);
  assert.equal(fromAlphaVantage(null), null);
  assert.equal(fromAlphaVantage({ Note: "rate limit reached" }), null);
});

test("alpha adapter: a blank or unparseable price is null", () => {
  for (const rawPrice of ["", "   ", "N/A", "-", "null"]) {
    const result = fromAlphaVantage({
      "Global Quote": { "01. symbol": "ZZZZ", "05. price": rawPrice },
    });

    assert.equal(result, null, `price ${JSON.stringify(rawPrice)} was accepted`);
  }
});

test("alpha adapter: a real price is still normalized", () => {
  const result = fromAlphaVantage(alphaQuoteFixture());

  assert.equal(result?.price, 125.78);
  assert.equal(result?.symbol, "IBM");
  assert.equal(result?.change, 0.38);
  assert.equal(result?.changePercent, 0.3031);
  assert.equal(result?.previousClose, 125.4);
});

test("alpha adapter: a price the provider really reports as 0 is still a quote", () => {
  // Absent and zero are different facts. Only absence is null.
  const result = fromAlphaVantage({
    "Global Quote": { "01. symbol": "ZERO", "05. price": "0" },
  });

  assert.notEqual(result, null);
  assert.equal(result?.price, 0);
});

test("upstox adapter: an entry with no last_price is not a ₹0 quote", () => {
  // The same defect, on the other Indian path. Number(quote.last_price ?? 0)
  // turned an absent price into a real-looking zero, and the Agent's price tool
  // accepts any non-NaN number (isValidPrice()), so "TCS trades at ₹0" was a
  // reachable answer. A reported 0 is still a quote; an absent one is not — the
  // Upstox entry is found by instrument_token exactly as it is in production.
  const UPSTOX_KEY = "NSE_EQ|INE467B01029";
  const envelope = (lastPrice: unknown) => ({
    status: "success",
    data: {
      "NSE_EQ:TCS": {
        instrument_token: UPSTOX_KEY,
        symbol: "TCS",
        last_price: lastPrice,
      },
    },
  });

  for (const missing of [undefined, null, "", "   "]) {
    assert.throws(
      () => fromUpstox(envelope(missing), UPSTOX_KEY),
      `last_price ${JSON.stringify(missing)} was turned into a price`
    );
  }

  assert.equal(fromUpstox(envelope(0), UPSTOX_KEY).price, 0);
  assert.equal(fromUpstox(envelope(2054), UPSTOX_KEY).price, 2054);
});

// ---------------------------------------------------------------------------
// The provider: the fabricated quote is gone, the fallback order is not
// ---------------------------------------------------------------------------

test("getMarketQuote: an unresolvable symbol is null, not a fabricated zero quote", async () => {
  // This is the regression. TwelveData yields nothing, Alpha Vantage sends its
  // empty envelope, Yahoo yields nothing — the symbol is unpriced, so the
  // answer is null. It used to be { price: 0 }.
  const { calls, run } = withProviders({
    twelve: null,
    alpha: alphaEmptyEnvelope(),
    yahoo: null,
  });

  const quote = await run("ZZZZ");

  assert.equal(quote, null);
  // And the chain is still tried in the same order: TwelveData → Alpha → Yahoo.
  assert.deepEqual(calls, ["twelve:ZZZZ", "alpha:ZZZZ", "yahoo:ZZZZ"]);
});

test("getMarketQuote: an empty Alpha envelope does not stop the Yahoo fallback", async () => {
  // The empty envelope must be treated as "no answer", so a later provider
  // still gets its turn — it must not short-circuit the chain with a zero.
  const { calls, run } = withProviders({
    twelve: {},
    alpha: alphaEmptyEnvelope(),
    yahoo: yahooQuoteFixture(),
  });

  const quote = await run("AAPL");

  assert.equal(quote?.price, 232.5);
  assert.deepEqual(calls, ["twelve:AAPL", "alpha:AAPL", "yahoo:AAPL"]);
});

test("getMarketQuote: a real Alpha Vantage quote is still used", async () => {
  const { calls, run } = withProviders({
    twelve: null,
    alpha: alphaQuoteFixture(),
    yahoo: yahooQuoteFixture(),
  });

  const quote = await run("IBM");

  assert.equal(quote?.price, 125.78);
  assert.equal(quote?.symbol, "IBM");
  // Yahoo was never reached: Alpha answered.
  assert.deepEqual(calls, ["twelve:IBM", "alpha:IBM"]);
});

test("getMarketQuote: TwelveData is still primary", async () => {
  const { calls, run } = withProviders({
    twelve: twelveQuoteFixture(),
    alpha: alphaQuoteFixture(),
    yahoo: yahooQuoteFixture(),
  });

  const quote = await run("AAPL");

  assert.equal(quote?.price, 331.51);
  assert.equal(quote?.currency, "USD");
  assert.deepEqual(calls, ["twelve:AAPL"]);
});

test("getMarketQuote: every provider failing is null", async () => {
  const { calls, run } = withProviders({
    twelve: null,
    alpha: null,
    yahoo: null,
  });

  assert.equal(await run("ZZZZ"), null);
  assert.deepEqual(calls, ["twelve:ZZZZ", "alpha:ZZZZ", "yahoo:ZZZZ"]);
});

test("getMarketQuote: an Indian symbol still never reaches a global provider", async () => {
  // The Indian branch is untouched by this fix, and this asserts the property
  // that matters: it answers through Upstox or not at all, so none of the three
  // injectable global lookups may be entered — not even with a symbol Upstox
  // fails to resolve.
  //
  // The network and the console are taken away for the duration. The console is
  // captured because lib/apis/upstox.ts dumps raw response bodies and
  // lib/apis/twelvedata.ts logs the API key it is configured with; a regression
  // here must not be able to put either into a test log. Nothing captured is
  // asserted on or printed.
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;

  const calls: string[] = [];

  globalThis.fetch = (async () => {
    throw new Error("network disabled in test");
  }) as typeof fetch;

  console.log = () => {};
  console.error = () => {};

  // Every global lookup would answer, if it were asked. None of them may be.
  const { twelve, alpha, yahoo } = recorders(
    {
      twelve: twelveQuoteFixture(),
      alpha: alphaQuoteFixture(),
      yahoo: yahooQuoteFixture(),
    },
    calls
  );

  try {
    const quote = await getMarketQuote("TCS", twelve, alpha, yahoo);

    assert.equal(quote, null);
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  }
});
