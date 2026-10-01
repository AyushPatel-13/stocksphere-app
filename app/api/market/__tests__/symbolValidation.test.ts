/**
 * Focused tests for symbol validation on /api/market and for the
 * percent-encoding of symbols at the provider boundary.
 *
 * Two defects are covered, and they are layers of the same fix:
 *
 *   1. /api/market took ?symbol= off the URL with only a trim() and passed it
 *      to a provider chain that interpolated it into a request URL. A caller
 *      could therefore supply "AAPL&outputsize=5000" and have those extra
 *      parameters land on the upstream request.
 *
 *   2. The provider clients interpolated the symbol unencoded. Even a value
 *      that passes validation must not be able to change the URL's shape.
 *
 * The route half is driven through the same injected lookups
 * app/api/market/__tests__/route.test.ts uses, so nothing here touches the
 * network. The encoding half stubs globalThis.fetch and inspects the URL the
 * client actually built.
 *
 * The existing 200/404/503/500 contract is untouched by this and is asserted in
 * full in route.test.ts; the one case repeated here is the 404, to show that
 * validating the input did not turn an unresolved symbol into a 400.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  type TwelveQuoteLookup,
  type AlphaQuoteLookup,
  type YahooQuoteLookup,
} from "@/lib/providers/market.provider";

import { isValidSymbol, MAX_SYMBOL_LENGTH } from "@/lib/validation/symbol";

import { GET } from "../route";

// ---------------------------------------------------------------------------
// isSymbolValid — the allowlist itself
// ---------------------------------------------------------------------------

test("the symbol formats StockSphere actually routes are all accepted", () => {
  // Indian: bare, .NS and .BSE.
  assert.equal(isValidSymbol("TCS"), true);
  assert.equal(isValidSymbol("TCS.NS"), true);
  assert.equal(isValidSymbol("RELIANCE"), true);
  assert.equal(isValidSymbol("RELIANCE.NS"), true);
  assert.equal(isValidSymbol("RELIANCE.BSE"), true);

  // Global, including a share-class dot.
  assert.equal(isValidSymbol("AAPL"), true);
  assert.equal(isValidSymbol("MSFT"), true);
  assert.equal(isValidSymbol("BRK.B"), true);

  // Real NSE tickers whose punctuation is not decorative: dropping either of
  // these from the allowlist would break a Nifty 50 constituent.
  assert.equal(isValidSymbol("M&M"), true);
  assert.equal(isValidSymbol("BAJAJ-AUTO"), true);
});

test("a symbol at the length cap is accepted and one past it is not", () => {
  const atCap = "A".repeat(MAX_SYMBOL_LENGTH);
  const pastCap = "A".repeat(MAX_SYMBOL_LENGTH + 1);

  assert.equal(isValidSymbol(atCap), true);
  assert.equal(isValidSymbol(pastCap), false);
});

test("malformed values are refused", () => {
  const rejected = [
    "", // blank — handled as "no symbol" by the route, never valid here
    "AAPL&outputsize=5000", // the injection from the audit
    "AAPL=y", // '=' is never a symbol character
    "AAPL/../etc", // path traversal shape
    "AAPL?x=1", // query metacharacter
    "AAPL#frag", // fragment metacharacter
    "AAPL%26", // pre-encoded input
    "AA PL", // interior whitespace
    "AAPL\n", // control character
    "<script>", // markup
    "TCS.NS;DROP", // separator outside the allowlist
    "-AAPL", // must start alphanumeric
    ".AAPL", // must start alphanumeric
    "café", // non-ASCII
  ];

  for (const value of rejected) {
    assert.equal(
      isValidSymbol(value),
      false,
      `expected ${JSON.stringify(value)} to be refused`
    );
  }
});

test('"AAPL&x" passes validation — which is exactly why encoding is required', () => {
  // Recorded deliberately. Validation cannot be the only control: this is a
  // value no provider will resolve, but it is also not obviously malformed, so
  // it gets through. It is inert only because the provider clients now encode
  // it — the test below proves that.
  assert.equal(isValidSymbol("AAPL&x"), true);
});

// ---------------------------------------------------------------------------
// The route — validation in front of the provider chain
// ---------------------------------------------------------------------------

type GlobalLookups = {
  twelve: TwelveQuoteLookup;
  alpha: AlphaQuoteLookup;
  yahoo: YahooQuoteLookup;
};

/** Lookups that must never be reached. */
function forbiddenLookups(): GlobalLookups {
  const refuse = () => {
    throw new Error("a provider was consulted for a rejected symbol");
  };

  return {
    twelve: refuse,
    alpha: refuse,
    yahoo: refuse,
  } as unknown as GlobalLookups;
}

function requestFor(symbol: string): Request {
  const url = new URL("http://localhost/api/market");
  url.searchParams.set("symbol", symbol);

  return new Request(url);
}

for (const symbol of ["TCS", "TCS.NS", "AAPL"]) {
  test(`a valid symbol (${symbol}) is accepted and passed through unchanged`, async () => {
    const seen: string[] = [];

    const response = await GET(
      requestFor(symbol),
      undefined,
      async (value: string) => {
        seen.push(value);

        return {
          symbol: value,
          price: 100,
          currency: "USD",
        };
      }
    );

    // Not 400. Whatever the provider then decides is a separate matter.
    assert.equal(response.status, 200);
    assert.deepEqual(seen, [symbol]);
  });
}

test("a rejected symbol is 400 and no provider is contacted", async () => {
  const response = await GET(
    requestFor("AAPL&outputsize=5000"),
    undefined,
    async () => {
      throw new Error("the provider chain must not run");
    },
    forbiddenLookups()
  );

  const json = (await response.json()) as {
    success: boolean;
    symbol: unknown;
    quote: unknown;
    error: string;
  };

  assert.equal(response.status, 400);
  assert.equal(json.success, false);
  assert.equal(json.error, "Invalid symbol");

  // The rejected input is not reflected back.
  assert.equal(json.symbol, null);
  assert.equal(json.quote, null);
  assert.equal(JSON.stringify(json).includes("outputsize"), false);
});

test("an oversized symbol is 400, not a provider call", async () => {
  const response = await GET(
    requestFor("A".repeat(MAX_SYMBOL_LENGTH + 1)),
    undefined,
    async () => {
      throw new Error("the provider chain must not run");
    },
    forbiddenLookups()
  );

  assert.equal(response.status, 400);
});

test("an unresolved symbol still behaves exactly as it did: 404, never 400", async () => {
  // The loader answers null and consults no provider, which is the route's
  // documented "nobody answered, but nobody declined either" path — the one an
  // Indian symbol takes. The point here is that a *well-formed* symbol that
  // resolves to nothing is not reclassified as invalid input.
  const response = await GET(
    requestFor("ZZZZ"),
    undefined,
    async () => null
  );

  const json = (await response.json()) as {
    success: boolean;
    symbol: string;
    quote: unknown;
    error: string;
  };

  assert.equal(response.status, 404);
  assert.notEqual(response.status, 400);
  assert.equal(json.success, false);
  assert.equal(json.quote, null);
  assert.equal(json.symbol, "ZZZZ");
});

test("a blank ?symbol= still falls through to the market-wide payload", async () => {
  // fetch is stubbed for the same reason route.test.ts stubs it: the Indian leg
  // of the market-wide payload is not injectable and goes through the real
  // Upstox client, so this keeps the test off the network either way.
  const { result: response } = await captureFetchUrls(() =>
    GET(
      new Request("http://localhost/api/market?symbol=%20%20"),
      undefined,
      async () => null
    )
  );

  const json = (await response.json()) as {
    us: Record<string, unknown>;
    india: unknown[];
    success?: boolean;
  };

  // 503 here is the total-outage answer for the market-wide payload, not a
  // 400 — the blank value is "no symbol", not an invalid one.
  assert.notEqual(response.status, 400);
  assert.deepEqual(Object.keys(json.us).sort(), [
    "apple",
    "microsoft",
    "nvidia",
    "tesla",
  ]);
  assert.ok(Array.isArray(json.india));
});

// ---------------------------------------------------------------------------
// The provider boundary — the symbol is percent-encoded into the URL
// ---------------------------------------------------------------------------

/** Run `fn` with fetch replaced by a recorder. Returns the URLs it saw. */
async function captureFetchUrls<T>(
  fn: () => Promise<T>
): Promise<{ result: T; urls: string[] }> {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(typeof input === "string" ? input : String(input));

    return new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    return { result: await fn(), urls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("Twelve Data encodes the symbol, so an injection cannot add parameters", async () => {
  const { getStockQuote } = await import("@/lib/apis/twelvedata");

  const { urls } = await captureFetchUrls(async () => {
    await getStockQuote("AAPL&outputsize=5000");
  });

  assert.equal(urls.length, 1);

  const parsed = new URL(urls[0]);

  // The whole value stays in the symbol position...
  assert.equal(
    parsed.searchParams.get("symbol"),
    "AAPL&outputsize=5000"
  );

  // ...and nothing it contained became a parameter of its own.
  assert.equal(parsed.searchParams.get("outputsize"), null);
  assert.equal(parsed.searchParams.getAll("apikey").length, 1);
  assert.equal(parsed.searchParams.getAll("symbol").length, 1);
});

test("Twelve Data encodes a real '&' symbol without splitting the query", async () => {
  const { getStockQuote } = await import("@/lib/apis/twelvedata");

  const { urls } = await captureFetchUrls(async () => {
    await getStockQuote("M&M");
  });

  const parsed = new URL(urls[0]);

  assert.equal(parsed.searchParams.get("symbol"), "M&M");
  assert.equal(parsed.searchParams.getAll("apikey").length, 1);
});

test("Finnhub encodes the symbol on both the profile and the news call", async () => {
  const { getCompanyProfile, getCompanyNews } = await import(
    "@/lib/apis/finnhub"
  );

  const profile = await captureFetchUrls(async () => {
    await getCompanyProfile("AAPL&token=stolen");
  });

  const profileUrl = new URL(profile.urls[0]);

  assert.equal(
    profileUrl.searchParams.get("symbol"),
    "AAPL&token=stolen"
  );
  // The injected "token" must not have become a query parameter of its own:
  // there is exactly one token, and it is not the value the caller supplied.
  assert.equal(profileUrl.searchParams.getAll("token").length, 1);
  assert.notEqual(profileUrl.searchParams.get("token"), "stolen");

  const news = await captureFetchUrls(async () => {
    await getCompanyNews("AAPL&token=stolen");
  });

  const newsUrl = new URL(news.urls[0]);

  assert.equal(
    newsUrl.searchParams.get("symbol"),
    "AAPL&token=stolen"
  );
  assert.equal(newsUrl.searchParams.getAll("token").length, 1);
});

test("Finnhub's financial-metrics call encodes the symbol too", async () => {
  const { getFinancialMetrics } = await import("@/lib/apis/finnhubFinancials");

  const { urls } = await captureFetchUrls(async () => {
    await getFinancialMetrics("AAPL&metric=stolen");
  });

  const parsed = new URL(urls[0]);

  assert.equal(parsed.searchParams.get("symbol"), "AAPL&metric=stolen");
  assert.equal(parsed.searchParams.get("metric"), "all");
  assert.equal(parsed.searchParams.getAll("token").length, 1);
});

test("a symbol with a '.' or '-' is still passed through intact", async () => {
  const { getStockQuote } = await import("@/lib/apis/twelvedata");

  const { urls } = await captureFetchUrls(async () => {
    await getStockQuote("BAJAJ-AUTO.NS");
  });

  const parsed = new URL(urls[0]);

  assert.equal(parsed.searchParams.get("symbol"), "BAJAJ-AUTO.NS");
});
