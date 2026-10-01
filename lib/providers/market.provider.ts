import { AssetQuote } from "../types/quote";

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
  return getIndianMarketQuotes(
    [...NIFTY_50_SYMBOLS]
  );
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
  lookupYahoo: YahooQuoteLookup = getYahooQuote
): Promise<AssetQuote | null> {
  // 🇮🇳 INDIA → UPSTOX PRIMARY
  //
  // Unchanged, and deliberately not routed through the injectable lookups
  // above: the Indian branch resolves through Upstox and answers null rather
  // than falling back to any global provider.
  if (isIndianSymbol(symbol)) {
    return getIndianMarketQuote(
      symbol
    );
  }

  // 🇺🇸 US / GLOBAL
  // TWELVE DATA → PRIMARY

  try {
    const twelve =
      await lookupTwelve(symbol);

    if (twelve?.close) {
      return fromTwelveData(
        twelve
      );
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
      return quote;
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
      return fromYahoo(yahoo);
    }
  } catch (error) {
    console.error(
      `Yahoo quote error [${symbol}]:`,
      error
    );
  }

  return null;
}