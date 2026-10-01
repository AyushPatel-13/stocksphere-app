import { getYahooQuote } from "../apis/yahoo";
import { getStockQuote as getTwelveQuote } from "../apis/twelvedata";
import {
  getUpstoxQuotes,
  searchUpstoxEquity,
} from "../apis/upstox";

import {
  normalizeYahooPrice,
  normalizeTwelvePrice,
  normalizeUpstoxPrice,
} from "../adapters/price";

import { StockPrice } from "../types/price";

import {
  bareIndianSymbol,
  isIndianEquitySymbol,
} from "../data/instruments/india";

/**
 * What fetchPrice returns.
 *
 * `symbol` is the symbol the caller supplied, echoed back unchanged. It is what
 * makes the Indian path verifiable from the outside: the Upstox instrument
 * lookup runs on the bare trading symbol, so without this field a caller could
 * not tell "RELIANCE.NS" from "RELIANCE" in the result — and those are different
 * securities. Global results carry it too so the shape does not vary by branch.
 */
export interface PriceResult {
  provider: string;
  symbol: string;
  data: StockPrice;
}

// A symbol is Indian if it carries the ".NS"/".BSE" convention OR if it is a
// bare symbol in the app's Indian instrument universe (lib/data/instruments/
// india.ts). The suffix test alone was the bug: "INFY" has no suffix, so it left
// this path entirely and TwelveData answered with the Infosys NYSE ADR — a
// different security, in USD, at roughly a hundredth of the NSE price.
//
// The second test is a membership check against the known universe, NOT a
// "has no dot, so assume India" rule. An unrecognised bare symbol ("ZZZZ") is
// still not Indian and still takes the global path, exactly as before.
function isIndianSymbol(symbol: string): boolean {
  return (
    symbol.endsWith(".NS") ||
    symbol.endsWith(".BSE") ||
    isIndianEquitySymbol(symbol)
  );
}

// The bare NSE trading symbol Upstox's instrument search expects. Shared with
// the rest of the app so "TCS", "tcs" and "TCS.NS" cannot normalise differently
// in different callers.
function normalizeIndianSymbol(symbol: string): string {
  return bareIndianSymbol(symbol);
}

/**
 * Injected lookups, following the convention of lib/providers/historical.ts,
 * news.ts and market.provider.ts: tests supply fakes, so no test needs
 * UPSTOX_ACCESS_TOKEN, a Yahoo reachability check, or a network. The `typeof`
 * aliases keep each default exactly as wide as the real client, so a fake
 * cannot be written against a looser signature than the production one.
 */
export type IndianInstrumentLookup = typeof searchUpstoxEquity;
export type IndianQuoteLookup = typeof getUpstoxQuotes;
export type YahooPriceLookup = typeof getYahooQuote;
export type TwelvePriceLookup = typeof getTwelveQuote;

/**
 * What classifyUpstoxPrice() concluded about a raw Upstox quote response.
 *
 * The three cases used to be one answer — everything that was not a price
 * became `null` — which meant "Upstox could not be read" and "Upstox answered
 * and holds no quote for this instrument" were reported identically. They are
 * different facts:
 *
 *   null / non-object            -> failure  (we do not know anything)
 *   { data: <no matching key> }  -> empty    (we know: no quote for this key)
 *   { data: {<key>: <quote>} }   -> ok
 *
 * StockPrice cannot represent "empty" — every field is required — so a caller
 * that only wants a price still collapses both non-ok cases to null. The
 * distinction is preserved here, in one exported and directly testable place,
 * for the same reason lib/agent/tools/historicalTool.ts exports
 * classifyHistorical() rather than folding failure into emptiness at the call
 * site.
 */
export type UpstoxPriceOutcome =
  | { status: "failure" }
  | { status: "empty" }
  | { status: "ok"; price: StockPrice };

/**
 * Decide which of the three cases a raw Upstox quote response is in.
 *
 * Exported so the decision can be unit-tested without a network or a stubbed
 * client, the same reason priceTool.ts exports isValidPrice() and
 * historicalTool.ts exports classifyHistorical().
 */
export function classifyUpstoxPrice(
  raw: unknown,
  instrumentKey: string
): UpstoxPriceOutcome {
  if (!raw || typeof raw !== "object") {
    return { status: "failure" };
  }

  const quotes = (raw as { data?: unknown }).data;

  // A response we cannot read is not the same as one that answered with
  // nothing in it.
  if (!quotes || typeof quotes !== "object") {
    return { status: "failure" };
  }

  const entries = quotes as Record<
    string,
    { instrument_token?: unknown } | undefined
  >;

  // Upstox keys its response by its own internal symbol string, not by the
  // instrument key that was asked for, so the entry has to be found by
  // instrument_token. This is the same lookup fromUpstox() performs.
  const matched = Object.keys(entries).some(
    (key) => entries[key]?.instrument_token === instrumentKey
  );

  if (!matched) {
    return { status: "empty" };
  }

  try {
    return {
      status: "ok",
      price: normalizeUpstoxPrice(raw, instrumentKey),
    };
  } catch {
    // The entry exists but yielded no usable price.
    return { status: "failure" };
  }
}

/**
 * Indian equities: Upstox only, with no fallback.
 *
 * This is the rule the rest of the app already follows — fetchIndianNews(),
 * getIndianMarketQuote(), fetchIndianFinancials() and fetchIndianHistorical()
 * all answer or nothing answers. The price path was the one exception: it sent
 * every symbol to Yahoo first, so an Indian equity was looked up in a namespace
 * that does not represent it and, when Yahoo rate-limits (HTTP 429) or demands
 * a consent redirect, fell through to a global provider holding the bare
 * ticker — a different security. Live: bare "RELIANCE" is not NSE's Reliance
 * Industries. There is deliberately no global fallback here, because no global
 * provider can serve ".NS"/".BSE" correctly.
 *
 * Returns null when Upstox could not produce a price — a refused request, an
 * unresolvable instrument, or a response carrying no quote. `symbol` is never
 * rewritten: the suffix is dropped for the instrument lookup only, and the
 * caller's canonical symbol travels back in the result.
 */
export async function fetchIndianPrice(
  symbol: string,
  lookupInstrument: IndianInstrumentLookup = searchUpstoxEquity,
  lookupQuote: IndianQuoteLookup = getUpstoxQuotes
): Promise<PriceResult | null> {
  try {
    // ".NS"/".BSE" is dropped for this Upstox instrument lookup only. Upstox has
    // no suffix concept and its search is an exact match on the NSE trading
    // symbol. The canonical symbol is never rewritten.
    const instrument = await lookupInstrument(
      normalizeIndianSymbol(symbol)
    );

    // Quotes are keyed by instrument_key, so an unresolved instrument means
    // there is nothing to ask about.
    if (!instrument?.instrument_key) {
      return null;
    }

    const raw = await lookupQuote([instrument.instrument_key]);
    const outcome = classifyUpstoxPrice(raw, instrument.instrument_key);

    if (outcome.status !== "ok") {
      return null;
    }

    console.log("✅ Upstox");

    return {
      provider: "Upstox",
      symbol,
      data: outcome.price,
    };
  } catch {
    // Covers a missing/expired UPSTOX_ACCESS_TOKEN, which getUpstoxQuotes()
    // and searchUpstoxEquity() both throw on. Callers must never see it.
    return null;
  }
}

/**
 * Non-Indian symbols: the existing global chain, unchanged.
 *
 * Still Yahoo first and TwelveData second, in that order and with the same
 * success tests as before (`quote` truthy, then `quote?.close`). Only the
 * echoed `symbol` is new.
 */
export async function fetchGlobalPrice(
  symbol: string,
  lookupYahoo: YahooPriceLookup = getYahooQuote,
  lookupTwelve: TwelvePriceLookup = getTwelveQuote
): Promise<PriceResult | null> {
  // Yahoo (Primary)
  try {
    const quote = await lookupYahoo(symbol);

    if (quote) {
      console.log("✅ Yahoo");

      return {
        provider: "Yahoo",
        symbol,
        data: normalizeYahooPrice(quote),
      };
    }
  } catch {}

  // TwelveData (Fallback)
  try {
    const quote = await lookupTwelve(symbol);

    if (quote?.close) {
      console.log("✅ TwelveData");

      return {
        provider: "TwelveData",
        symbol,
        data: normalizeTwelvePrice(quote),
      };
    }
  } catch {}

  return null;
}

/**
 * Universal price entry point: Indian symbols route to Upstox, everything else
 * to the existing global chain.
 *
 * This mirrors fetchHistorical() in lib/providers/historical.ts — the same
 * isIndianSymbol branch, the same injectable lookups, the same "Indian answers
 * through Upstox or not at all" rule. The two branches return the identical
 * PriceResult shape, which is why lib/services/price.ts and
 * app/stock/[symbol]/page.tsx need no change.
 */
export async function fetchPrice(
  symbol: string,
  lookupIndianInstrument: IndianInstrumentLookup = searchUpstoxEquity,
  lookupIndianQuote: IndianQuoteLookup = getUpstoxQuotes,
  lookupGlobalYahoo: YahooPriceLookup = getYahooQuote,
  lookupGlobalTwelve: TwelvePriceLookup = getTwelveQuote
): Promise<PriceResult | null> {
  if (isIndianSymbol(symbol)) {
    return fetchIndianPrice(
      symbol,
      lookupIndianInstrument,
      lookupIndianQuote
    );
  }

  return fetchGlobalPrice(symbol, lookupGlobalYahoo, lookupGlobalTwelve);
}
