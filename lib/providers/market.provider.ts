import { AssetQuote } from "../types/quote";
import { yahooFallbackQuote, type ChartQuoteLookup } from "./yahooFallback";
import { getYahooChartQuote } from "../apis/yahooChart";

import { getYahooQuote } from "../apis/yahoo";
import { getStockQuote as getAlphaQuote } from "../apis/alphavantage";
import { getStockQuote as getTwelveQuote } from "../apis/twelvedata";
import {
  getUpstoxQuotes,
  searchUpstoxEquity,
} from "../apis/upstox";

import {
  fromYahoo,
  fromAlphaVantage,
  fromTwelveData,
  fromUpstox,
} from "../adapters/quote.adapter";

import {
  NIFTY_50_SYMBOLS,
  bareIndianSymbol,
  isIndianEquitySymbol,
} from "../data/instruments/india";

/**
 * The three global quote lookups getMarketQuote() falls back through, named so
 * tests can inject fakes — the same convention lib/providers/price.ts uses for
 * its own global chain (YahooPriceLookup / TwelvePriceLookup).
 *
 * These exist because the chain's third provider, Yahoo, is not fetch-based:
 * yahoo-finance2 talks to the network through its own client, so stubbing
 * globalThis.fetch cannot reach it. Without injectable lookups a test of the
 * fallback would have to make a real request to Yahoo.
 */
export type TwelveQuoteLookup = typeof getTwelveQuote;
export type AlphaQuoteLookup = typeof getAlphaQuote;
export type YahooQuoteLookup = typeof getYahooQuote;

// A symbol is Indian if it carries the ".NS"/".BSE" convention OR if it is a
// bare symbol in the app's Indian instrument universe
// (lib/data/instruments/india.ts), which is the single place this decision is
// made. The suffix test alone used to send a bare Indian ticker down the global
// chain below (TwelveData → Alpha Vantage → Yahoo), where it is a different
// security.
function isIndianSymbol(
  symbol: string
): boolean {
  return (
    symbol.endsWith(".NS") ||
    symbol.endsWith(".BSE") ||
    isIndianEquitySymbol(symbol)
  );
}

// The bare NSE trading symbol Upstox's instrument search expects. Shared with
// the rest of the app so "TCS", "tcs" and "TCS.NS" cannot normalise differently
// in different callers.
function normalizeIndianSymbol(
  symbol: string
): string {
  return bareIndianSymbol(symbol);
}

/**
 * Get a single Indian stock quote.
 *
 * Upstox is the primary provider for Indian equities.
 */
async function getIndianMarketQuote(
  symbol: string
): Promise<AssetQuote | null> {
  const cleanSymbol =
    normalizeIndianSymbol(symbol);

  try {
    const instrument =
      await searchUpstoxEquity(
        cleanSymbol
      );

    if (!instrument?.instrument_key) {
      console.log(
        `No Upstox instrument found for ${cleanSymbol}`
      );

      return null;
    }

    const data =
      await getUpstoxQuotes([
        instrument.instrument_key,
      ]);

    if (!data) {
      return null;
    }

    return fromUpstox(
      data,
      instrument.instrument_key
    );
  } catch (error) {
    console.error(
      `Upstox quote error [${symbol}]:`,
      error
    );

    return null;
  }
}

/**
 * Get multiple Indian stock quotes.
 *
 * Instrument keys are resolved first and then
 * all quotes are requested through one bulk
 * Upstox request.
 */
export async function getIndianMarketQuotes(
  symbols: string[]
): Promise<AssetQuote[]> {
  try {
    const cleanSymbols =
      symbols.map(
        normalizeIndianSymbol
      );

    const instruments =
      await Promise.all(
        cleanSymbols.map(
          (symbol) =>
            searchUpstoxEquity(symbol)
        )
      );

    const instrumentKeys =
      instruments
        .map(
          (instrument) =>
            instrument?.instrument_key
        )
        .filter(
          (
            key
          ): key is string =>
            key !== undefined
        );

    if (
      instrumentKeys.length === 0
    ) {
      return [];
    }

    const data =
      await getUpstoxQuotes(
        instrumentKeys
      );

    if (!data) {
      return [];
    }

    return instrumentKeys
      .map((instrumentKey) => {
        try {
          return fromUpstox(
            data,
            instrumentKey
          );
        } catch (error) {
          console.error(
            `Failed to normalize ${instrumentKey}:`,
            error
          );

          return null;
        }
      })
      .filter(
        (
          quote
        ): quote is AssetQuote =>
          quote !== null
      );
  } catch (error) {
    console.error(
      "Upstox bulk quote error:",
      error
    );

    return [];
  }
}

/**
 * Get all Nifty 50 quotes.
 *
 * The Nifty 50 symbol universe is defined
 * in lib/data/instruments/india.ts.
 */
export async function getNifty50Quotes(): Promise<
  AssetQuote[]
> {
  return withYahooFill(
    [...NIFTY_50_SYMBOLS],
    await getIndianMarketQuotes([...NIFTY_50_SYMBOLS])
  );
}

/**
 * Upstox quotes first; any symbol Upstox didn't price (an expired daily
 * token prices none) is asked of Yahoo for the same NSE listing, labelled as
 * a fallback. A symbol neither can price is left out, never zero-filled.
 */
export async function withYahooFill(
  symbols: string[],
  upstox: AssetQuote[],
  lookup: ChartQuoteLookup = getYahooChartQuote
): Promise<AssetQuote[]> {
  const priced = new Set(upstox.map((q) => bareIndianSymbol(String(q.symbol).toUpperCase())));
  const missing = symbols.filter((s) => !priced.has(bareIndianSymbol(s.toUpperCase())));
  if (missing.length === 0) return upstox.map((q) => ({ ...q, source: q.source ?? "Upstox" }));

  // These are NSE symbols by definition, so each is asked for as its .NS listing.
  const filled = await Promise.all(missing.map((s) => yahooFallbackQuote(`${bareIndianSymbol(s.toUpperCase())}.NS`, lookup)));
  return [
    ...upstox.map((q) => ({ ...q, source: q.source ?? "Upstox" })),
    ...filled.filter((q): q is AssetQuote => q !== null).map((q) => ({ ...q, symbol: bareIndianSymbol(q.symbol) })),
  ];
}

/**
 * Universal market quote provider.
 *
 * India:
 *   Upstox → primary
 *
 * US / Global:
 *   Twelve Data → primary
 *   Alpha Vantage → backup
 *   Yahoo → last resort
 */
export async function getMarketQuote(
  symbol: string,
  lookupTwelve: TwelveQuoteLookup = getTwelveQuote,
  lookupAlpha: AlphaQuoteLookup = getAlphaQuote,
  lookupYahoo: YahooQuoteLookup = getYahooQuote,
  lookupChart: ChartQuoteLookup = getYahooChartQuote
): Promise<AssetQuote | null> {
  // 🇮🇳 INDIA → UPSTOX PRIMARY
  //
  // Unchanged, and deliberately not routed through the injectable lookups
  // above: the Indian branch resolves through Upstox and answers null rather
  // than falling back to any global provider.
  if (isIndianSymbol(symbol)) {
    const upstox = await getIndianMarketQuote(symbol);
    if (upstox) return { ...upstox, source: "Upstox" };
    // Upstox down or its daily token expired: the same NSE listing from Yahoo.
    return yahooFallbackQuote(symbol, lookupChart);
  }

  // 🇺🇸 US / GLOBAL
  // TWELVE DATA → PRIMARY

  try {
    const twelve =
      await lookupTwelve(symbol);

    if (twelve?.close) {
      return { ...fromTwelveData(twelve), source: "Twelve Data" };
    }
  } catch (error) {
    console.error(
      `Twelve Data quote error [${symbol}]:`,
      error
    );
  }

  // ALPHA VANTAGE → BACKUP

  try {
    const alpha =
      await lookupAlpha(symbol);

    // No "is Global Quote present?" test here any more. That check was the bug:
    // a symbol Alpha Vantage cannot resolve still comes back as
    // {"Global Quote": {}}, and an empty object is truthy — so the guard passed
    // and fromAlphaVantage() was handed nothing to normalize. The adapter now
    // answers null for a response with no price, which is the only test that
    // actually distinguishes "a quote" from "an envelope".
    const quote =
      fromAlphaVantage(alpha);

    if (quote) {
      return { ...quote, source: "Alpha Vantage" };
    }
  } catch (error) {
    console.error(
      `Alpha Vantage quote error [${symbol}]:`,
      error
    );
  }

  // YAHOO → LAST RESORT

  try {
    const yahoo =
      await lookupYahoo(symbol);

    if (yahoo?.price) {
      return { ...fromYahoo(yahoo), source: "Yahoo" };
    }
  } catch (error) {
    console.error(
      `Yahoo quote error [${symbol}]:`,
      error
    );
  }

  // Yahoo's chart endpoint needs no crumb and keeps answering when the
  // quote API above is rate-limited.
  return yahooFallbackQuote(symbol, lookupChart);
}