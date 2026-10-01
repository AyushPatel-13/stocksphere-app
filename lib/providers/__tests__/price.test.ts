import { test } from "node:test";
import assert from "node:assert/strict";

import {
  fetchPrice,
  fetchIndianPrice,
  fetchGlobalPrice,
  classifyUpstoxPrice,
  type IndianInstrumentLookup,
  type IndianQuoteLookup,
  type TwelvePriceLookup,
  type YahooPriceLookup,
} from "@/lib/providers/price";

import { INDIAN_EQUITY_SYMBOLS, NIFTY_50_SYMBOLS } from "@/lib/data/instruments/india";

const TCS_KEY = "NSE_EQ|INE467B01029";

/**
 * The live Upstox v3 quote envelope.
 *
 * Keyed by Upstox's own symbol string ("NSE_EQ:TCS") and carrying the
 * instrument_token inside the entry, which is what both fromUpstox() and
 * classifyUpstoxPrice() have to search for — the response key is not the
 * instrument key that was asked for.
 */
function upstoxQuoteEnvelope(instrumentKey: string, lastPrice = 2054) {
  return {
    status: "success",
    data: {
      "NSE_EQ:TCS": {
        instrument_token: instrumentKey,
        symbol: "TCS",
        last_price: lastPrice,
        prev_close_price: 2076,
        net_change: lastPrice - 2076,
        ohlc: { open: 2054, high: 2090.2, low: 2038.1 },
        volume: 3342195,
      },
    },
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

/** Field for field the shape getStockQuote() (TwelveData) returns. */
function twelveQuoteFixture() {
  return {
    symbol: "AAPL",
    close: "232.50",
    change: "1.20",
    percent_change: "0.52",
    open: "231.00",
    high: "233.00",
    low: "230.50",
    previous_close: "231.30",
    volume: "1234567",
    currency: "USD",
  };
}

/**
 * Wire fetchPrice to recording fakes.
 *
 * Every lookup appends to `calls`, so a test can assert not only what was used
 * but what was NOT reached. That is the only way to prove "Indian symbols never
 * call a global provider" — the absence of a call is the assertion.
 */
function withPriceLookups(
  options: {
    instrumentKey?: string | null;
    quoteResponse?: unknown;
    yahooQuote?: unknown;
    twelveQuote?: unknown;
    throwOnInstrument?: boolean;
    throwOnQuote?: boolean;
  } = {}
) {
  const calls: string[] = [];

  const instrument: IndianInstrumentLookup = async (bare: string) => {
    calls.push(`instrument:${bare}`);

    if (options.throwOnInstrument) {
      throw new Error("UPSTOX_ACCESS_TOKEN is missing from environment variables");
    }

    return options.instrumentKey === null
      ? null
      : { instrument_key: options.instrumentKey ?? TCS_KEY };
  };

  const quote: IndianQuoteLookup = async (keys: string[]) => {
    calls.push(`quote:${keys.join(",")}`);

    if (options.throwOnQuote) {
      throw new Error("UPSTOX_ACCESS_TOKEN is missing from environment variables");
    }

    return options.quoteResponse ?? null;
  };

  const yahoo: YahooPriceLookup = async (symbol: string) => {
    calls.push(`yahoo:${symbol}`);
    return options.yahooQuote as Awaited<ReturnType<YahooPriceLookup>>;
  };

  const twelve: TwelvePriceLookup = async (symbol: string) => {
    calls.push(`twelve:${symbol}`);
    return options.twelveQuote;
  };

  return {
    calls,
    run: (symbol: string) =>
      fetchPrice(symbol, instrument, quote, yahoo, twelve),
  };
}

// ---------------------------------------------------------------------------
// Indian routing: Upstox only
// ---------------------------------------------------------------------------

test("TCS.NS routes to Upstox and to nothing else", async () => {
  const { calls, run } = withPriceLookups({
    quoteResponse: upstoxQuoteEnvelope(TCS_KEY),
  });

  const result = await run("TCS.NS");

  assert.equal(result?.provider, "Upstox");
  assert.equal(result?.data.price, 2054);
  // Exactly two calls, both Upstox: the instrument lookup then the quote.
  assert.deepEqual(calls, ["instrument:TCS", `quote:${TCS_KEY}`]);
});

test("RELIANCE.NS routes to Upstox and to nothing else", async () => {
  const { calls, run } = withPriceLookups({
    instrumentKey: "NSE_EQ|INE002A01018",
    quoteResponse: upstoxQuoteEnvelope("NSE_EQ|INE002A01018", 2890.5),
  });

  const result = await run("RELIANCE.NS");

  assert.equal(result?.provider, "Upstox");
  assert.equal(result?.data.price, 2890.5);
  assert.deepEqual(calls, [
    "instrument:RELIANCE",
    "quote:NSE_EQ|INE002A01018",
  ]);
});

test("a .BSE symbol routes to Upstox too", async () => {
  const { calls, run } = withPriceLookups({
    quoteResponse: upstoxQuoteEnvelope(TCS_KEY),
  });

  const result = await run("TCS.BSE");

  assert.equal(result?.provider, "Upstox");
  // ".BSE" is stripped for the lookup exactly as ".NS" is.
  assert.deepEqual(calls, ["instrument:TCS", `quote:${TCS_KEY}`]);
});

test("no Indian symbol reaches Yahoo, TwelveData or any global provider", async () => {
  for (const symbol of [
    "TCS.NS",
    "RELIANCE.NS",
    "INFY.NS",
    "TCS.BSE",
    "RELIANCE.BSE",
  ]) {
    const { calls, run } = withPriceLookups({
      quoteResponse: upstoxQuoteEnvelope(TCS_KEY),
    });

    await run(symbol);

    const global = calls.filter(
      (call) => call.startsWith("yahoo:") || call.startsWith("twelve:")
    );

    assert.deepEqual(global, [], `${symbol} reached a global provider: ${global}`);
  }
});

test("a failing Upstox lookup does NOT fall back to a global provider", async () => {
  // The instrument resolves, but Upstox returns no quote. On the old price path
  // this is exactly where Yahoo and then TwelveData would have been tried.
  const { calls, run } = withPriceLookups({ quoteResponse: null });

  const result = await run("RELIANCE.NS");

  assert.equal(result, null);
  assert.deepEqual(calls, ["instrument:RELIANCE", `quote:${TCS_KEY}`]);
});

test("an unresolvable Indian instrument returns null without any quote call", async () => {
  const { calls, run } = withPriceLookups({ instrumentKey: null });

  const result = await run("NOTREAL.NS");

  assert.equal(result, null);
  // Nothing to ask about, so no quote request is made.
  assert.deepEqual(calls, ["instrument:NOTREAL"]);
});

test("a throwing Upstox client is contained, and still no global fallback", async () => {
  const { calls, run } = withPriceLookups({ throwOnInstrument: true });

  assert.equal(await run("TCS.NS"), null);

  const { calls: quoteThrows, run: runQuoteThrows } = withPriceLookups({
    throwOnQuote: true,
  });

  assert.equal(await runQuoteThrows("TCS.NS"), null);

  for (const recorded of [calls, quoteThrows]) {
    assert.deepEqual(
      recorded.filter((c) => c.startsWith("yahoo:") || c.startsWith("twelve:")),
      []
    );
  }
});

// ---------------------------------------------------------------------------
// Canonical symbol preservation
// ---------------------------------------------------------------------------

test("the returned symbol stays canonical while Upstox gets the bare one", async () => {
  for (const symbol of ["TCS.NS", "TCS.BSE"]) {
    const { calls, run } = withPriceLookups({
      quoteResponse: upstoxQuoteEnvelope(TCS_KEY),
    });

    const result = await run(symbol);

    // The suffix is dropped for the Upstox lookup only...
    assert.equal(calls[0], "instrument:TCS");
    // ...and the caller's symbol comes back untouched.
    assert.equal(result?.symbol, symbol);
  }
});

test("the canonical symbol survives a real end-to-end Indian lookup", async () => {
  const { run } = withPriceLookups({
    quoteResponse: upstoxQuoteEnvelope(TCS_KEY),
  });

  const result = await run("RELIANCE.NS");

  assert.equal(result?.symbol, "RELIANCE.NS");
  assert.notEqual(result?.symbol, "RELIANCE");
  assert.equal(result?.data.currency, "INR");
});

// ---------------------------------------------------------------------------
// Global routing: unchanged
// ---------------------------------------------------------------------------

test("AAPL still uses the global path, Yahoo first", async () => {
  const { calls, run } = withPriceLookups({
    yahooQuote: yahooQuoteFixture(),
  });

  const result = await run("AAPL");

  assert.equal(result?.provider, "Yahoo");
  assert.equal(result?.symbol, "AAPL");
  assert.equal(result?.data.price, 232.5);
  assert.deepEqual(calls, ["yahoo:AAPL"]);
});

test("AAPL falls back to TwelveData when Yahoo fails, as before", async () => {
  const { calls, run } = withPriceLookups({
    yahooQuote: null,
    twelveQuote: twelveQuoteFixture(),
  });

  const result = await run("AAPL");

  assert.equal(result?.provider, "TwelveData");
  assert.equal(result?.data.price, 232.5);
  assert.deepEqual(calls, ["yahoo:AAPL", "twelve:AAPL"]);
});

test("a global symbol never reaches the Upstox lookups", async () => {
  const { calls, run } = withPriceLookups({
    yahooQuote: yahooQuoteFixture(),
  });

  await run("AAPL");

  assert.deepEqual(
    calls.filter((c) => c.startsWith("instrument:") || c.startsWith("quote:")),
    []
  );
});

test("a global symbol with no provider at all returns null", async () => {
  const { calls, run } = withPriceLookups({});

  assert.equal(await run("AAPL"), null);
  assert.deepEqual(calls, ["yahoo:AAPL", "twelve:AAPL"]);
});

// ---------------------------------------------------------------------------
// Bare Indian symbols: the suffix is a convention, not the definition
// ---------------------------------------------------------------------------

test("a bare Indian symbol routes to Upstox and to nothing else", async () => {
  for (const symbol of ["TCS", "RELIANCE", "INFY"]) {
    const { calls, run } = withPriceLookups({
      quoteResponse: upstoxQuoteEnvelope(TCS_KEY),
    });

    const result = await run(symbol);

    assert.equal(result?.provider, "Upstox", `${symbol} did not use Upstox`);
    // Upstox's search wants the bare trading symbol, which is what it already is.
    assert.deepEqual(calls, [`instrument:${symbol}`, `quote:${TCS_KEY}`]);
  }
});

test("bare INFY never reaches a global provider", async () => {
  // The live defect: bare INFY has no ".NS", so it left this path entirely and
  // TwelveData answered with the Infosys NYSE ADR — a different security, in
  // USD, at roughly a hundredth of the NSE price.
  const { calls, run } = withPriceLookups({
    quoteResponse: upstoxQuoteEnvelope(TCS_KEY),
  });

  const result = await run("INFY");

  assert.equal(result?.provider, "Upstox");
  assert.equal(result?.symbol, "INFY");
  assert.equal(result?.data.currency, "INR");
  assert.deepEqual(
    calls.filter((c) => c.startsWith("yahoo:") || c.startsWith("twelve:")),
    []
  );
});

test("a bare Indian symbol is echoed back bare, not silently suffixed", async () => {
  const { run } = withPriceLookups({
    quoteResponse: upstoxQuoteEnvelope(TCS_KEY),
  });

  const result = await run("RELIANCE");

  // The caller's symbol is theirs; canonicalisation is internal.
  assert.equal(result?.symbol, "RELIANCE");
});

test("a bare Indian symbol with no Upstox answer returns null, not a global security", async () => {
  // The safety rule: if Upstox cannot answer for a known Indian equity, the
  // answer is "unavailable", never a similarly-named foreign listing.
  const { calls, run } = withPriceLookups({ quoteResponse: null });

  assert.equal(await run("INFY"), null);
  assert.deepEqual(calls, ["instrument:INFY", `quote:${TCS_KEY}`]);
});

test("an unknown bare symbol is NOT treated as Indian just because it has no dot", async () => {
  // Guards against the tempting-but-wrong `if (!symbol.includes(".")) symbol += ".NS"`.
  for (const symbol of ["ZZZZ", "NOTREAL", "AAPL", "MSFT"]) {
    const { calls, run } = withPriceLookups({ yahooQuote: yahooQuoteFixture() });

    const result = await run(symbol);

    assert.equal(result?.provider, "Yahoo", `${symbol} should use the global path`);
    assert.deepEqual(calls, [`yahoo:${symbol}`]);
  }
});

test("a lowercase Indian spelling is treated as Indian, and normalises for Upstox", async () => {
  for (const symbol of ["tcs", "tcs.ns", "reliance.bse"]) {
    const { calls, run } = withPriceLookups({
      quoteResponse: upstoxQuoteEnvelope(TCS_KEY),
    });

    await run(symbol);

    // Recognised as Indian, and normalised to the bare trading symbol.
    assert.match(calls[0], /^instrument:(TCS|RELIANCE)$/, `${symbol}: ${calls[0]}`);
    assert.deepEqual(
      calls.filter((c) => c.startsWith("yahoo:") || c.startsWith("twelve:")),
      []
    );
  }
});

test("drift guard: every known Indian symbol routes to Upstox when bare", async () => {
  for (const symbol of INDIAN_EQUITY_SYMBOLS) {
    const { calls, run } = withPriceLookups({
      quoteResponse: upstoxQuoteEnvelope(TCS_KEY),
    });

    const result = await run(symbol);

    assert.equal(result?.provider, "Upstox", `bare ${symbol} did not use Upstox`);
    assert.deepEqual(
      calls.filter((c) => c.startsWith("yahoo:") || c.startsWith("twelve:")),
      [],
      `bare ${symbol} reached a global provider`
    );
  }
});

// ---------------------------------------------------------------------------
// Failure vs a legitimate empty result
// ---------------------------------------------------------------------------

test("classifyUpstoxPrice separates an unreadable response from an empty one", () => {
  // Unreadable: we know nothing.
  assert.deepEqual(classifyUpstoxPrice(null, TCS_KEY), { status: "failure" });
  assert.deepEqual(classifyUpstoxPrice(undefined, TCS_KEY), { status: "failure" });
  assert.deepEqual(classifyUpstoxPrice("nope", TCS_KEY), { status: "failure" });
  assert.deepEqual(classifyUpstoxPrice({}, TCS_KEY), { status: "failure" });
  assert.deepEqual(
    classifyUpstoxPrice({ status: "success" }, TCS_KEY),
    { status: "failure" }
  );

  // Readable, and it holds no quote for this instrument: a real answer.
  assert.deepEqual(
    classifyUpstoxPrice({ status: "success", data: {} }, TCS_KEY),
    { status: "empty" }
  );
  assert.deepEqual(
    classifyUpstoxPrice(
      { status: "success", data: { "NSE_EQ:OTHER": { instrument_token: "X" } } },
      TCS_KEY
    ),
    { status: "empty" }
  );

  // The quote is present and usable.
  const outcome = classifyUpstoxPrice(upstoxQuoteEnvelope(TCS_KEY), TCS_KEY);

  assert.equal(outcome.status, "ok");
  assert.equal(outcome.status === "ok" && outcome.price.price, 2054);
});

test("an empty-but-readable Upstox response is not reported as a failure", async () => {
  const { run } = withPriceLookups({
    quoteResponse: { status: "success", data: {} },
  });

  // Both collapse to null at the fetchPrice boundary, because StockPrice has no
  // way to express "no quote" — but the classifier above keeps them distinct.
  assert.equal(await run("TCS.NS"), null);
});

test("a quote missing from an otherwise successful response is empty, not failure", () => {
  const outcome = classifyUpstoxPrice(
    { status: "success", data: { "NSE_EQ:TCS": { symbol: "TCS" } } },
    TCS_KEY
  );

  // The entry exists but carries no instrument_token match, so it is not this
  // instrument's quote.
  assert.equal(outcome.status, "empty");
});

// ---------------------------------------------------------------------------
// Direct entry points
// ---------------------------------------------------------------------------

test("fetchIndianPrice and fetchGlobalPrice are separately reachable", async () => {
  const envelope = upstoxQuoteEnvelope(TCS_KEY);

  const indian = await fetchIndianPrice(
    "TCS.NS",
    async () => ({ instrument_key: TCS_KEY }),
    async () => envelope
  );

  assert.equal(indian?.provider, "Upstox");
  assert.equal(indian?.symbol, "TCS.NS");

  const global = await fetchGlobalPrice(
    "AAPL",
    async () => yahooQuoteFixture(),
    async () => undefined
  );

  assert.equal(global?.provider, "Yahoo");
  assert.equal(global?.symbol, "AAPL");
});

// ---------------------------------------------------------------------------
// Drift guard
// ---------------------------------------------------------------------------

test("drift guard: every NIFTY 50 symbol routes to Upstox, not a global provider", async () => {
  for (const symbol of NIFTY_50_SYMBOLS) {
    const { calls, run } = withPriceLookups({
      quoteResponse: upstoxQuoteEnvelope(TCS_KEY),
    });

    const result = await run(`${symbol}.NS`);

    assert.equal(result?.provider, "Upstox", `${symbol}.NS did not use Upstox`);
    assert.equal(
      calls.filter((c) => c.startsWith("yahoo:") || c.startsWith("twelve:")).length,
      0,
      `${symbol}.NS reached a global provider`
    );
  }
});
