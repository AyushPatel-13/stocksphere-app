import { getCompanyNews } from "../apis/finnhub";
import { searchUpstoxEquity } from "../apis/upstox";
import { getUpstoxNews, type UpstoxNewsItem } from "../apis/upstoxNews";
import { normalizeUpstoxNews } from "../adapters/news";
import { NewsArticle } from "../types/news";

/**
 * Injected lookups, following the same convention as
 * createSymbolResolverTool()'s searchIndianCandidates parameter and the
 * financials provider's lookups — tests supply fakes, so nothing needs
 * UPSTOX_ACCESS_TOKEN, FINNHUB_API_KEY or a network.
 */
export type IndianInstrumentLookup = (
  symbol: string
) => Promise<{ instrument_key?: string } | null>;

export type IndianNewsLookup = (
  instrumentKey: string
) => Promise<UpstoxNewsItem[] | null>;

export type GlobalNewsLookup = (
  symbol: string
) => Promise<NewsArticle[] | null>;

// Mirrors the routing rule in lib/providers/market.provider.ts, where
// isIndianSymbol/normalizeIndianSymbol are module-private and therefore not
// importable. Kept identical so the news path, the quote path, the company path
// and the financials path all agree on what counts as an Indian symbol.
//
// Note this is case-sensitive, so "tcs.ns" is not recognised as Indian — an
// inherited limitation of the rule, not a new one, and the symbol resolver
// canonicalises to upper case before any tool reaches here.
function isIndianSymbol(symbol: string): boolean {
  return (
    symbol.endsWith(".NS") ||
    symbol.endsWith(".BSE")
  );
}

function normalizeIndianSymbol(symbol: string): string {
  return symbol
    .replace(".NS", "")
    .replace(".BSE", "")
    .toUpperCase();
}

/**
 * Indian equities: Upstox only, with no fallback.
 *
 * This mirrors getIndianMarketQuote() in lib/providers/market.provider.ts and
 * fetchIndianFinancials() — the established rule for Indian symbols is that
 * Upstox answers or nothing does. There is deliberately no Finnhub fallback:
 * Finnhub answers HTTP 403 for every ".NS" symbol on this plan. The bare
 * trading symbol is used for the Upstox instrument lookup and nowhere else;
 * it is never sent to Finnhub.
 *
 * Returns null only when the provider genuinely failed. A successful response
 * with no articles is `data: []`, which is a different thing and must stay
 * distinguishable — see lib/services/news.ts.
 */
export async function fetchIndianNews(
  symbol: string,
  lookupInstrument: IndianInstrumentLookup = searchUpstoxEquity,
  lookupNews: IndianNewsLookup = getUpstoxNews
) {
  try {
    // ".NS"/".BSE" is dropped for this Upstox instrument lookup only. Upstox
    // has no suffix concept and its search is an exact match on the NSE
    // trading symbol. The canonical symbol is never rewritten.
    const instrument = await lookupInstrument(
      normalizeIndianSymbol(symbol)
    );

    // The news feed is keyed by instrument_key, so an unresolved instrument
    // means there is nothing to ask about.
    if (!instrument?.instrument_key) {
      return null;
    }

    const rows = await lookupNews(instrument.instrument_key);

    // null means the feed could not be read; [] means it was read and is empty.
    if (rows === null) {
      return null;
    }

    console.log("✅ Upstox News");

    return {
      provider: "Upstox",
      data: normalizeUpstoxNews(rows),
    };
  } catch {
    // Covers a missing/expired UPSTOX_ACCESS_TOKEN, which getUpstoxNews()
    // throws on. Callers must never see it.
    return null;
  }
}

/**
 * Non-Indian symbols: Finnhub, unchanged.
 *
 * getCompanyNews() now reports a request Finnhub refused as null instead of
 * handing back its JSON error body, so a 403 can no longer be mistaken for an
 * empty feed.
 */
export async function fetchGlobalNews(
  symbol: string,
  lookupNews: GlobalNewsLookup = getCompanyNews
) {
  try {
    const news = await lookupNews(symbol);

    if (news === null) {
      return null;
    }

    console.log("✅ Finnhub News");

    return {
      provider: "Finnhub",
      data: news,
    };
  } catch {
    return null;
  }
}

/**
 * Universal news entry point: Indian symbols route to Upstox, everything else
 * to Finnhub.
 */
export async function fetchNews(
  symbol: string,
  lookupIndianInstrument: IndianInstrumentLookup = searchUpstoxEquity,
  lookupIndianNews: IndianNewsLookup = getUpstoxNews,
  lookupGlobalNews: GlobalNewsLookup = getCompanyNews
) {
  if (isIndianSymbol(symbol)) {
    return fetchIndianNews(
      symbol,
      lookupIndianInstrument,
      lookupIndianNews
    );
  }

  return fetchGlobalNews(
    symbol,
    lookupGlobalNews
  );
}
