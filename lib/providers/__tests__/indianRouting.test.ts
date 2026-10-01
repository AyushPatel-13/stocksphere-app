import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchHistorical } from "@/lib/providers/historical";
import { fetchNews } from "@/lib/providers/news";
import { fetchCompany } from "@/lib/providers/company";
import { fetchFinancials } from "@/lib/providers/financials";

import { INDIAN_EQUITY_SYMBOLS } from "@/lib/data/instruments/india";
import type { HistoricalRange } from "@/lib/types/historical";

/**
 * Cross-provider routing: a known Indian equity must not be answered by a
 * global provider, in any spelling.
 *
 * The price path's own version of this lives in price.test.ts. This file covers
 * the four sibling providers that duplicated the same suffix-only rule and had
 * the same defect — historical, news, company and financials — and it exists
 * because that defect was not theoretical:
 *
 *   getHistorical("INFY")  -> TwelveData NYSE ADR candles, in USD
 *   getNews("INFY")        -> Finnhub's unrelated global/crypto headlines
 *   getFinancials("TCS")   -> a market-cap figure in a different unit entirely
 *
 * Every harness below records the calls it receives. The absence of a call is
 * the assertion: "never reaches a global provider" cannot be proved by looking
 * at the answer alone, because a global provider may answer with something
 * plausible.
 */

const INFY_KEY = "NSE_EQ|INE009A01021";
const INFY_ISIN = "INE009A01021";

/** One raw Upstox candle: [timestamp, open, high, low, close, volume, oi]. */
function upstoxCandle(date = "2026-09-25"): unknown[] {
  return [`${date}T00:00:00+05:30`, 1000, 1100, 990, 1050, 12345, 0];
}

/** What TwelveData answers for a global symbol. */
function globalHistoricalPayload() {
  return {
    values: [
      {
        datetime: "2026-09-25",
        open: 10,
        high: 11,
        low: 9,
        close: 10.53,
        volume: 1000,
      },
    ],
  };
}

/** One raw Upstox news row. published_time is unix MILLISECONDS. */
function upstoxNewsItem() {
  return {
    heading: "Infosys wins a large deal",
    summary: "The company said the order is its largest this year.",
    thumbnail: "https://upstox.com/thumb.jpg",
    article_link: "https://upstox.com/news/infy-deal",
    published_time: 1790063368434,
  };
}

/** What Finnhub's by-ticker feed answers — deliberately unrelated to India. */
function globalNewsArticle() {
  return {
    id: 1,
    headline: "Chainlink rallies as crypto markets recover",
    summary: "Unrelated global coverage.",
    image: "",
    source: "Some Newswire",
    url: "https://example.com/crypto",
    datetime: 1790063368,
  };
}

// ---------------------------------------------------------------------------
// Historical
// ---------------------------------------------------------------------------

function withHistoricalLookups(
  options: {
    instrumentKey?: string | null;
    candles?: unknown[][] | null;
    global?: ReturnType<typeof globalHistoricalPayload> | null;
  } = {}
) {
  const calls: string[] = [];

  const run = (symbol: string, range?: HistoricalRange) =>
    fetchHistorical(
      symbol,
      range,
      async (bare) => {
        calls.push(`instrument:${bare}`);

        return options.instrumentKey === null
          ? null
          : { instrument_key: options.instrumentKey ?? INFY_KEY };
      },
      async (instrumentKey) => {
        calls.push(`candles:${instrumentKey}`);

        return options.candles === undefined
          ? [upstoxCandle()]
          : options.candles;
      },
      async (globalSymbol) => {
        calls.push(`global:${globalSymbol}`);

        return options.global === undefined
          ? globalHistoricalPayload()
          : options.global;
      }
    );

  return { calls, run };
}

test("historical: a bare Indian symbol routes to Upstox and nothing else", async () => {
  const { calls, run } = withHistoricalLookups();
  const result = await run("INFY");

  assert.equal(result?.provider, "Upstox");
  assert.deepEqual(calls, [`instrument:INFY`, `candles:${INFY_KEY}`]);
  assert.equal(result?.data.values.length, 1);
  assert.equal(result?.data.values[0].datetime, "2026-09-25");
});

test("historical: bare INFY never reaches TwelveData", async () => {
  // The live defect: bare INFY has no ".NS", so it left this path and
  // TwelveData answered with the Infosys NYSE ADR — a different security, on a
  // different exchange, in USD. This is the chart on /stock/INFY.
  const { calls, run } = withHistoricalLookups();
  const result = await run("INFY");

  assert.deepEqual(
    calls.filter((call) => call.startsWith("global:")),
    []
  );
  assert.equal(result?.provider, "Upstox");
});

test("historical: '.NS' and bare spellings take the same path", async () => {
  for (const symbol of ["INFY", "INFY.NS", "infy", "infy.ns"]) {
    const { calls, run } = withHistoricalLookups();
    const result = await run(symbol);

    assert.equal(result?.provider, "Upstox", `${symbol} did not use Upstox`);
    assert.deepEqual(calls, [`instrument:INFY`, `candles:${INFY_KEY}`]);
  }
});

test("historical: an Indian symbol whose Upstox lookup fails returns null, not global candles", async () => {
  const { calls, run } = withHistoricalLookups({ candles: null });
  const result = await run("INFY");

  assert.equal(result, null);
  assert.deepEqual(
    calls.filter((call) => call.startsWith("global:")),
    []
  );
});

test("historical: an unresolvable Indian instrument returns null without a candle call", async () => {
  const { calls, run } = withHistoricalLookups({ instrumentKey: null });
  const result = await run("INFY");

  assert.equal(result, null);
  assert.deepEqual(calls, ["instrument:INFY"]);
});

test("historical: a global symbol still uses TwelveData", async () => {
  const { calls, run } = withHistoricalLookups();
  const result = await run("AAPL");

  assert.equal(result?.provider, "TwelveData");
  assert.deepEqual(calls, ["global:AAPL"]);
});

test("historical: an unknown bare symbol is NOT treated as Indian", async () => {
  for (const symbol of ["ZZZZ", "NOTREAL", "TSLA"]) {
    const { calls, run } = withHistoricalLookups();
    const result = await run(symbol);

    assert.equal(result?.provider, "TwelveData", `${symbol} should use TwelveData`);
    assert.deepEqual(calls, [`global:${symbol}`]);
  }
});

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

function withNewsLookups(
  options: {
    instrumentKey?: string | null;
    indianNews?: ReturnType<typeof upstoxNewsItem>[] | null;
    globalNews?: ReturnType<typeof globalNewsArticle>[] | null;
  } = {}
) {
  const calls: string[] = [];

  const run = (symbol: string) =>
    fetchNews(
      symbol,
      async (bare) => {
        calls.push(`instrument:${bare}`);

        return options.instrumentKey === null
          ? null
          : { instrument_key: options.instrumentKey ?? INFY_KEY };
      },
      async (instrumentKey) => {
        calls.push(`indianNews:${instrumentKey}`);

        return options.indianNews === undefined
          ? [upstoxNewsItem()]
          : options.indianNews;
      },
      async (globalSymbol) => {
        calls.push(`globalNews:${globalSymbol}`);

        return options.globalNews === undefined
          ? [globalNewsArticle()]
          : options.globalNews;
      }
    );

  return { calls, run };
}

test("news: a bare Indian symbol routes to Upstox and nothing else", async () => {
  const { calls, run } = withNewsLookups();
  const result = await run("INFY");

  assert.equal(result?.provider, "Upstox");
  assert.deepEqual(calls, [`instrument:INFY`, `indianNews:${INFY_KEY}`]);
  assert.equal(result?.data[0].headline, "Infosys wins a large deal");
  assert.equal(result?.data[0].source, "Upstox");
});

test("news: bare INFY no longer returns Finnhub's unrelated feed", async () => {
  // The live defect: Finnhub tags articles by the ticker it was asked about, so
  // a bare "INFY" came back with crypto and unrelated global coverage.
  const { calls, run } = withNewsLookups();
  const result = await run("INFY");

  assert.deepEqual(
    calls.filter((call) => call.startsWith("globalNews:")),
    []
  );
  assert.equal(result?.data[0].headline, "Infosys wins a large deal");
});

test("news: an Indian symbol with no Upstox answer returns null, not global news", async () => {
  // Both the "instrument unresolved" and "feed unreadable" cases must stop
  // here rather than fall through to Finnhub with a bare trading symbol.
  const unresolved = withNewsLookups({ instrumentKey: null });
  assert.equal(await unresolved.run("INFY"), null);

  const unreadable = withNewsLookups({ indianNews: null });
  assert.equal(await unreadable.run("INFY"), null);

  for (const harness of [unresolved, unreadable]) {
    assert.deepEqual(
      harness.calls.filter((call) => call.startsWith("globalNews:")),
      []
    );
  }
});

test("news: a global symbol still uses Finnhub", async () => {
  const { calls, run } = withNewsLookups();
  const result = await run("AAPL");

  assert.equal(result?.provider, "Finnhub");
  assert.deepEqual(calls, ["globalNews:AAPL"]);
  assert.equal(result?.data[0].headline, "Chainlink rallies as crypto markets recover");
});

test("news: an unknown bare symbol is NOT treated as Indian", async () => {
  for (const symbol of ["ZZZZ", "TSLA"]) {
    const { calls, run } = withNewsLookups();
    const result = await run(symbol);

    assert.equal(result?.provider, "Finnhub", `${symbol} should use Finnhub`);
    assert.deepEqual(calls, [`globalNews:${symbol}`]);
  }
});

// ---------------------------------------------------------------------------
// Financials
// ---------------------------------------------------------------------------

function withFinancialsLookups(
  options: {
    isin?: string | null;
    ratios?: { name?: unknown; company_value?: unknown }[] | null;
    metrics?: { metric?: Record<string, number> } | null;
  } = {}
) {
  const calls: string[] = [];

  const run = (symbol: string) =>
    fetchFinancials(
      symbol,
      async (bare) => {
        calls.push(`instrument:${bare}`);

        return options.isin === null ? null : { isin: options.isin ?? INFY_ISIN };
      },
      async (isin) => {
        calls.push(`ratios:${isin}`);

        return options.ratios === undefined
          ? [{ name: "P/E", company_value: "24.5" }]
          : options.ratios;
      },
      async (globalSymbol) => {
        calls.push(`metrics:${globalSymbol}`);

        return options.metrics === undefined
          ? { metric: { marketCapitalization: 123456, peTTM: 30.1 } }
          : options.metrics;
      }
    );

  return { calls, run };
}

test("financials: a bare Indian symbol routes to Upstox and nothing else", async () => {
  const { calls, run } = withFinancialsLookups();
  const result = await run("INFY");

  assert.equal(result?.provider, "Upstox");
  assert.deepEqual(calls, [`instrument:INFY`, `ratios:${INFY_ISIN}`]);
  assert.equal(result?.data.pe, 24.5);
});

test("financials: bare INFY never reaches Finnhub", async () => {
  const { calls, run } = withFinancialsLookups();
  await run("INFY");

  assert.deepEqual(
    calls.filter((call) => call.startsWith("metrics:")),
    []
  );
});

test("financials: an Indian symbol with no Upstox answer returns null, not Finnhub metrics", async () => {
  const unresolved = withFinancialsLookups({ isin: null });
  assert.equal(await unresolved.run("TCS"), null);

  const unreadable = withFinancialsLookups({ ratios: null });
  assert.equal(await unreadable.run("TCS"), null);

  for (const harness of [unresolved, unreadable]) {
    assert.deepEqual(
      harness.calls.filter((call) => call.startsWith("metrics:")),
      []
    );
  }
});

test("financials: a global symbol still uses Finnhub", async () => {
  const { calls, run } = withFinancialsLookups();
  const result = await run("AAPL");

  assert.equal(result?.provider, "Finnhub");
  assert.deepEqual(calls, ["metrics:AAPL"]);
  assert.equal(result?.data.marketCap, 123456);
});

test("financials: an unknown bare symbol is NOT treated as Indian", async () => {
  for (const symbol of ["ZZZZ", "TSLA"]) {
    const { calls, run } = withFinancialsLookups();
    const result = await run(symbol);

    assert.equal(result?.provider, "Finnhub", `${symbol} should use Finnhub`);
    assert.deepEqual(calls, [`metrics:${symbol}`]);
  }
});

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

/**
 * Run `fn` with the network and the console taken away.
 *
 * fetchCompany's global chain (Finnhub, then Alpha Vantage) is not injectable —
 * it calls the real clients directly — so this is the only way to observe
 * whether it was entered without making a real request. fetch is replaced with
 * a recorder that throws, which turns "did not reach the network" into a
 * countable assertion.
 *
 * The console is captured for the same reason and its contents are deliberately
 * never asserted on or printed: lib/apis/finnhub.ts logs the API key it is
 * configured with, and a regression here must not be able to put that in a test
 * log. `logs` is returned for callers that want to ignore it.
 */
async function withoutNetwork<T>(
  fn: () => Promise<T>
): Promise<{ result: T; fetchCalls: string[] }> {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;

  const fetchCalls: string[] = [];

  globalThis.fetch = (async (input: unknown) => {
    fetchCalls.push(String(input));

    throw new Error("network disabled in test");
  }) as typeof fetch;

  console.log = () => {};
  console.error = () => {};

  try {
    return { result: await fn(), fetchCalls };
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  }
}

test("company: a bare Indian symbol routes to Upstox and nothing else", async () => {
  const searchCalls: string[] = [];

  const { result, fetchCalls } = await withoutNetwork(() =>
    fetchCompany("INFY", async (bare) => {
      searchCalls.push(bare);

      return { name: "Infosys Ltd", exchange: "NSE" };
    })
  );

  assert.equal(result?.provider, "Upstox");
  assert.equal(result?.data.name, "Infosys Ltd");
  assert.equal(result?.data.currency, "INR");
  // Upstox's search wants the bare trading symbol, which is what it already is.
  assert.deepEqual(searchCalls, ["INFY"]);
  // The global chain was never entered — so no Finnhub or Alpha Vantage request
  // was attempted for a symbol that means something else in their namespaces.
  assert.deepEqual(fetchCalls, []);
});

test("company: '.NS' and bare spellings take the same path", async () => {
  for (const symbol of ["INFY", "INFY.NS", "infy.bse"]) {
    const searchCalls: string[] = [];

    const { result, fetchCalls } = await withoutNetwork(() =>
      fetchCompany(symbol, async (bare) => {
        searchCalls.push(bare);

        return { name: "Infosys Ltd", exchange: "NSE" };
      })
    );

    assert.equal(result?.provider, "Upstox", `${symbol} did not use Upstox`);
    assert.deepEqual(searchCalls, ["INFY"]);
    assert.deepEqual(fetchCalls, []);
  }
});

test("company: a failed Upstox lookup returns null rather than a same-named foreign company", async () => {
  // This is the one provider whose two chains used to be reachable in sequence.
  // A bare "TCS" is a different company in Finnhub's and Alpha Vantage's
  // namespaces, so the answer must be "unavailable", not that company.
  const { result, fetchCalls } = await withoutNetwork(() =>
    fetchCompany("TCS", async () => null)
  );

  assert.equal(result, null);
  assert.deepEqual(fetchCalls, []);
});

test("company: a global symbol still uses the global chain", async () => {
  // Not classified as Indian: the global chain is entered (both clients are
  // attempted) and no Upstox search is made. The network is disabled, so no
  // provider can answer and the result is null — which is the point.
  const searchCalls: string[] = [];

  const { result, fetchCalls } = await withoutNetwork(() =>
    fetchCompany("AAPL", async (bare) => {
      searchCalls.push(bare);

      return { name: "Apple Inc.", exchange: "NASDAQ" };
    })
  );

  assert.equal(result, null);
  assert.deepEqual(searchCalls, []);
  // Finnhub then Alpha Vantage, exactly as before this change.
  assert.equal(fetchCalls.length, 2);
});

test("company: an unknown bare symbol is NOT treated as Indian", async () => {
  for (const symbol of ["ZZZZ", "TSLA"]) {
    const searchCalls: string[] = [];

    const { fetchCalls } = await withoutNetwork(() =>
      fetchCompany(symbol, async (bare) => {
        searchCalls.push(bare);

        return { name: "Unrelated", exchange: "NYSE" };
      })
    );

    assert.deepEqual(searchCalls, [], `${symbol} should not use Upstox`);
    assert.equal(fetchCalls.length, 2, `${symbol} should use the global chain`);
  }
});

// ---------------------------------------------------------------------------
// Drift guard
// ---------------------------------------------------------------------------

test("drift guard: every known Indian symbol is Indian on every provider path", async () => {
  // One assertion per provider per symbol. If a provider ever falls back to a
  // suffix-only rule, this fails on the bare spelling rather than waiting for a
  // user to notice a chart drawn from a different security.
  for (const symbol of INDIAN_EQUITY_SYMBOLS) {
    const historical = withHistoricalLookups();
    await historical.run(symbol);
    assert.equal(
      historical.calls.filter((call) => call.startsWith("global:")).length,
      0,
      `historical: bare ${symbol} reached a global provider`
    );

    const news = withNewsLookups();
    await news.run(symbol);
    assert.equal(
      news.calls.filter((call) => call.startsWith("globalNews:")).length,
      0,
      `news: bare ${symbol} reached a global provider`
    );

    const financials = withFinancialsLookups();
    await financials.run(symbol);
    assert.equal(
      financials.calls.filter((call) => call.startsWith("metrics:")).length,
      0,
      `financials: bare ${symbol} reached a global provider`
    );
  }
});

test("drift guard: no global symbol is classified Indian", async () => {
  for (const symbol of ["AAPL", "MSFT", "TSLA", "GOOGL", "NVDA"]) {
    const historical = withHistoricalLookups();
    await historical.run(symbol);
    assert.deepEqual(historical.calls, [`global:${symbol}`]);

    const news = withNewsLookups();
    await news.run(symbol);
    assert.deepEqual(news.calls, [`globalNews:${symbol}`]);

    const financials = withFinancialsLookups();
    await financials.run(symbol);
    assert.deepEqual(financials.calls, [`metrics:${symbol}`]);
  }
});
