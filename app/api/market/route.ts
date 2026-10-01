import { NextResponse } from "next/server";

import {
  getMarketQuote,
  getIndianMarketQuotes,
  type AlphaQuoteLookup,
  type TwelveQuoteLookup,
  type YahooQuoteLookup,
} from "@/lib/providers/market.provider";

import { getStockQuote as getTwelveQuote } from "@/lib/apis/twelvedata";
import { getStockQuote as getAlphaQuote } from "@/lib/apis/alphavantage";
import { getYahooQuote } from "@/lib/apis/yahoo";

import { isValidSymbol } from "@/lib/validation/symbol";

export const revalidate = 60;

const US_SYMBOLS = {
  apple: "AAPL",
  microsoft: "MSFT",
  tesla: "TSLA",
  nvidia: "NVDA",
};

const INDIAN_SYMBOLS = [
  "RELIANCE.NS",
  "TCS.NS",
  "HDFCBANK.NS",
  "INFY.NS",
];

/**
 * The three global quote clients the chain falls back through.
 *
 * They are named here so the endpoint can watch how each one behaved, and
 * injectable so that watching can be tested without the network — the same
 * reason market.provider.ts takes them as parameters, and the same shape
 * lib/providers/__tests__/marketQuote.test.ts injects. Yahoo especially cannot
 * be intercepted by replacing globalThis.fetch: yahoo-finance2 reaches the
 * network through its own client.
 */
type GlobalQuoteLookups = {
  twelve: TwelveQuoteLookup;
  alpha: AlphaQuoteLookup;
  yahoo: YahooQuoteLookup;
};

const REAL_GLOBAL_LOOKUPS: GlobalQuoteLookups = {
  twelve: getTwelveQuote,
  alpha: getAlphaQuote,
  yahoo: getYahooQuote,
};

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null
  );
}

/**
 * Whether a provider actually answered us.
 *
 * This is the whole point of the file. getMarketQuote() answers null for a
 * symbol nobody can price AND for a symbol every provider failed to answer, and
 * the two must not be reported as one: the first is a 404, the second is a 503,
 * because a symbol that a failing provider would have priced exists just as
 * much as one it resolved.
 *
 * "Answered" therefore means: the provider responded about *this symbol*, one
 * way or the other. "Unavailable" means it never got that far — a transport
 * error, or the service itself saying it could not serve the request. A
 * provider failing to serve us is emphatically not an answer of "no such
 * symbol", which is the mistake this distinction exists to prevent.
 */
function twelveDataAnswered(raw: unknown): boolean {
  if (!isRecord(raw)) return false;

  // TwelveData's error envelope. code 400 is "**symbol** not found": the
  // request was understood and refused, which is an answer. 401 (key
  // rejected), 429 (credits exhausted) and 5xx are the service declining to
  // serve us — a real symbol would have been refused exactly the same way.
  if (raw.status === "error") {
    return raw.code === 400;
  }

  // A quote envelope always names the instrument it priced.
  return (
    typeof raw.symbol === "string" &&
    raw.symbol.trim().length > 0
  );
}

/**
 * Alpha Vantage signals "I could not serve this request" — exhausted quota, an
 * invalid call — with one of these envelopes. They are not answers about the
 * symbol.
 */
const ALPHA_SERVICE_ERROR_KEYS = [
  "Note",
  "Information",
  "Error Message",
];

function alphaVantageAnswered(raw: unknown): boolean {
  if (!isRecord(raw)) return false;

  if (
    ALPHA_SERVICE_ERROR_KEYS.some(
      (key) => key in raw
    )
  ) {
    return false;
  }

  // {"Global Quote": {}} is the opposite: a well-formed answer meaning "I have
  // no such symbol", which the adapter already turns into null rather than a
  // quote of zero.
  return "Global Quote" in raw;
}

/**
 * getYahooQuote answers null both for a symbol it cannot find and for a request
 * that failed — its own catch covers the two identically — so a null there
 * cannot be read as an answer. A resolved quote is an object.
 */
function yahooAnswered(raw: unknown): boolean {
  return isRecord(raw);
}

/**
 * Wrap one provider lookup so the route can see how it behaved.
 *
 * The wrapper is transparent by construction: it returns exactly what the
 * lookup returned and rethrows exactly what it threw, so getMarketQuote's
 * ordering, its fallbacks and its null contract are untouched. Only the
 * observation is new. The throw is re-raised deliberately rather than swallowed
 * here, because getMarketQuote's own catch already owns it.
 */
function observe<T>(
  lookup: (symbol: string) => Promise<T>,
  answered: (raw: unknown) => boolean,
  outcomes: boolean[]
): (symbol: string) => Promise<T> {
  return async (symbol: string) => {
    try {
      const raw = await lookup(symbol);

      outcomes.push(answered(raw));

      return raw;
    } catch (error) {
      outcomes.push(false);

      throw error;
    }
  };
}

/**
 * One symbol, resolved through the provider chain that already exists.
 *
 * getMarketQuote is the same entry point the stock page's price path uses, and
 * it already applies the Indian canonical routing: a bare "TCS", a suffixed
 * "TCS.NS" and a lowercase "tcs" all normalise to the NSE symbol and reach
 * Upstox, while a global ticker goes to TwelveData → Alpha Vantage → Yahoo.
 * This branch exposes that path; it does not duplicate it.
 *
 * `loadQuote` is injectable for the same reason /api/market/movers takes an
 * injectable provider: the unexpected-exception path below is otherwise
 * unreachable, because every provider call inside getMarketQuote() has its own
 * catch. Next.js calls a route handler with (request, context), so an injected
 * dependency has to sit after both.
 */
async function getSingleQuote(
  symbol: string,
  loadQuote: typeof getMarketQuote,
  lookups: GlobalQuoteLookups
) {
  // One entry per provider that was actually consulted, in chain order.
  const answered: boolean[] = [];

  try {
    const quote = await loadQuote(
      symbol,
      observe(
        lookups.twelve,
        twelveDataAnswered,
        answered
      ),
      observe(
        lookups.alpha,
        alphaVantageAnswered,
        answered
      ),
      observe(
        lookups.yahoo,
        yahooAnswered,
        answered
      )
    );

    if (quote) {
      return NextResponse.json({
        success: true,
        symbol,
        quote,
      });
    }

    // Nobody priced it, and there are two entirely different reasons why.
    //
    //   - a provider answered, and its answer was "no such symbol" → 404
    //   - every provider we consulted failed to answer at all → 503, because
    //     the symbol may be perfectly valid and we simply could not ask
    //
    // An Indian symbol reaches neither path. getMarketQuote resolves it
    // through Upstox and deliberately never enters the three lookups above, so
    // `answered` stays empty and the 404 below is its unchanged behaviour.
    if (
      answered.length > 0 &&
      answered.every((entry) => !entry)
    ) {
      console.error(
        `Market quote: no provider answered for ${symbol}`
      );

      return NextResponse.json(
        {
          success: false,
          symbol,
          quote: null,
          error: "Market data sources are unavailable",
        },
        { status: 503 }
      );
    }

    // A caller cannot mistake a missing quote for a real one.
    return NextResponse.json(
      {
        success: false,
        symbol,
        quote: null,
        error: "No quote available for this symbol",
      },
      { status: 404 }
    );
  } catch (error) {
    console.error(
      `Market quote error [${symbol}]:`,
      error
    );

    return NextResponse.json(
      {
        success: false,
        symbol,
        quote: null,
        error: "Failed to load quote",
      },
      { status: 500 }
    );
  }
}

/**
 * The market-wide payload: four global quotes and four Indian ones.
 */
async function getMarketOverview(
  loadQuote: typeof getMarketQuote,
  lookups: GlobalQuoteLookups
) {
  try {
    const [
      apple,
      microsoft,
      tesla,
      nvidia,
      indianQuotes,
    ] = await Promise.all([
      loadQuote(
        US_SYMBOLS.apple,
        lookups.twelve,
        lookups.alpha,
        lookups.yahoo
      ),
      loadQuote(
        US_SYMBOLS.microsoft,
        lookups.twelve,
        lookups.alpha,
        lookups.yahoo
      ),
      loadQuote(
        US_SYMBOLS.tesla,
        lookups.twelve,
        lookups.alpha,
        lookups.yahoo
      ),
      loadQuote(
        US_SYMBOLS.nvidia,
        lookups.twelve,
        lookups.alpha,
        lookups.yahoo
      ),
      getIndianMarketQuotes(INDIAN_SYMBOLS),
    ]);

    const us = {
      apple,
      microsoft,
      tesla,
      nvidia,
    };

    // getIndianMarketQuotes() reports "Upstox could not be reached", "Upstox
    // answered with an error" and "the payload held nothing normalisable" the
    // same way — as an empty array — and getMarketQuote answers null for a
    // symbol no provider could price as well as for one no provider could
    // answer. So an all-empty answer is the one case where success:true would
    // be a false claim: every source we asked failed.
    //
    // An empty array is otherwise unreachable while INDIAN_SYMBOLS is a
    // non-empty constant of real NSE symbols, and the four US tickers are
    // mega-caps, so "all four null" is not a quiet market either.
    //
    // A *partial* answer still succeeds, exactly as before: Upstox alone being
    // unavailable leaves the four global quotes intact and the caller is told
    // the truth about the rest.
    const noUsQuote = Object.values(us).every(
      (quote) => quote === null
    );
    const noIndiaQuote =
      indianQuotes.length === 0 &&
      INDIAN_SYMBOLS.length > 0;

    if (noUsQuote && noIndiaQuote) {
      console.error(
        "Market API: no provider returned a quote"
      );

      return NextResponse.json(
        {
          success: false,
          us,
          india: indianQuotes,
          error: "Market data sources are unavailable",
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: true,
      us,
      india: indianQuotes,
    });
  } catch (error) {
    console.error(
      "Market API error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        us: {
          apple: null,
          microsoft: null,
          tesla: null,
          nvidia: null,
        },
        india: [],
        error: "Failed to load market data",
      },
      { status: 500 }
    );
  }
}

export async function GET(
  request: Request,
  _context?: unknown,
  loadQuote: typeof getMarketQuote = getMarketQuote,
  lookups: GlobalQuoteLookups = REAL_GLOBAL_LOOKUPS
) {
  // An absent or blank ?symbol= falls through to the market-wide payload
  // below, which is the route's original behaviour.
  const symbol = new URL(request.url).searchParams
    .get("symbol")
    ?.trim();

  // A value that is not a symbol never reaches a provider.
  //
  // Before this it was passed through verbatim and interpolated into provider
  // URLs, so "AAPL&outputsize=5000" became extra query parameters on the
  // upstream request. The provider clients now percent-encode their values as
  // well; this refuses the malformed value outright rather than relying on
  // that alone.
  //
  // 400 is new, and it is additive: a symbol that *is* a symbol still takes
  // exactly the 200/404/503/500 paths below, unchanged.
  //
  // The rejected value is deliberately not echoed back — a failure body that
  // repeats caller-supplied text is a reflection nothing here needs, which is
  // why `symbol` is null rather than the input.
  if (symbol && !isValidSymbol(symbol)) {
    return NextResponse.json(
      {
        success: false,
        symbol: null,
        quote: null,
        error: "Invalid symbol",
      },
      { status: 400 }
    );
  }

  if (symbol) {
    return getSingleQuote(
      symbol,
      loadQuote,
      lookups
    );
  }

  return getMarketOverview(
    loadQuote,
    lookups
  );
}
