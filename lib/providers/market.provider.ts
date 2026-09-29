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
} from "../data/instruments/india";

function isIndianSymbol(
  symbol: string
): boolean {
  return (
    symbol.endsWith(".NS") ||
    symbol.endsWith(".BSE")
  );
}

function normalizeIndianSymbol(
  symbol: string
): string {
  return symbol
    .replace(".NS", "")
    .replace(".BSE", "")
    .toUpperCase();
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
  symbol: string
): Promise<AssetQuote | null> {
  // 🇮🇳 INDIA → UPSTOX PRIMARY
  if (isIndianSymbol(symbol)) {
    return getIndianMarketQuote(
      symbol
    );
  }

  // 🇺🇸 US / GLOBAL
  // TWELVE DATA → PRIMARY

  try {
    const twelve =
      await getTwelveQuote(symbol);

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
      await getAlphaQuote(symbol);

    if (
      alpha?.["Global Quote"]
    ) {
      return fromAlphaVantage(
        alpha
      );
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
      await getYahooQuote(symbol);

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