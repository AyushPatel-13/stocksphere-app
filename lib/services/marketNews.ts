import { getMarketNews, type FinnhubMarketNewsItem } from "../apis/finnhub";
import { fetchFeed } from "../apis/rssFeed";
import { searchUpstoxEquity } from "../apis/upstox";
import { getUpstoxNewsForKeys, type UpstoxNewsItem } from "../apis/upstoxNews";
import { parseFeedDate, parseRss, toPlainText, type RssItem } from "../news/rss";
import {
  SOURCE_NAMES,
  type NewsFeed,
  type NewsItem,
  type NewsRegion,
  type NewsSourceId,
  type NewsSourceStatus,
} from "../news/types";

/**
 * Market News: one feed per region, merged from several free sources.
 *
 * India  Upstox news for 30 large Nifty 50 names (Upstox has no market-wide
 *        category), NSE corporate announcements, ET Markets and Business
 *        Standard RSS headlines.
 * US     Finnhub general market news (free plan).
 *
 * Only headlines, short summaries and links are shown; every item links to
 * its publisher. Each source fails on its own: a dead feed marks that source
 * unavailable and the rest still load.
 */

export const FEEDS = {
  nse: "https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml",
  et: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
  bs: "https://www.business-standard.com/rss/markets-106.rss",
} as const;

/** Upstox accepts at most 30 instrument keys per news request. */
export const UPSTOX_NEWS_SYMBOLS = [
  "RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "BHARTIARTL", "ITC", "LT",
  "SBIN", "KOTAKBANK", "AXISBANK", "HINDUNILVR", "BAJFINANCE", "M&M", "MARUTI",
  "SUNPHARMA", "HCLTECH", "NTPC", "TITAN", "ULTRACEMCO", "TATASTEEL", "POWERGRID",
  "ONGC", "ADANIPORTS", "ASIANPAINT", "WIPRO", "BAJAJFINSV", "COALINDIA",
  "NESTLEIND", "ETERNAL",
] as const;

export const NEWS_CACHE_TTL_MS = 5 * 60_000;
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const MAX_ITEMS = 80;
const MAX_SUMMARY = 280;
// NSE publishes a filing every few seconds during market hours; without a cap
// they push every news headline off the page.
const MAX_PER_SOURCE: Partial<Record<NewsSourceId, number>> = { nse: 25 };

export interface NewsDeps {
  fetchFeed: (url: string) => Promise<string | null>;
  getUpstoxNewsForKeys: typeof getUpstoxNewsForKeys;
  /** NSE symbol → Upstox instrument key, or null. */
  resolveInstrumentKey: (symbol: string) => Promise<string | null>;
  getMarketNews: () => Promise<FinnhubMarketNewsItem[] | null>;
  now: () => number;
}

// Instrument keys never change for a listed stock, so a resolved key is kept
// for the life of the server process; only failures are retried.
const resolvedKeys = new Map<string, string>();

async function resolveInstrumentKey(symbol: string): Promise<string | null> {
  const known = resolvedKeys.get(symbol);
  if (known) return known;

  try {
    const instrument = await searchUpstoxEquity(symbol);
    const key = typeof instrument?.instrument_key === "string" ? instrument.instrument_key : null;
    if (key) resolvedKeys.set(symbol, key);
    return key;
  } catch {
    return null;
  }
}

const DEFAULT_DEPS: NewsDeps = {
  fetchFeed,
  getUpstoxNewsForKeys,
  resolveInstrumentKey,
  getMarketNews,
  now: Date.now,
};

/* ------------------------------------------------------------------ */
/* Normalisers (exported for tests)                                    */
/* ------------------------------------------------------------------ */

function text(value: unknown): string {
  return typeof value === "string" ? toPlainText(value) : "";
}

function clip(value: string, max = MAX_SUMMARY): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

/** Only absolute http(s) links reach the page. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function item(
  source: NewsSourceId,
  fields: Omit<NewsItem, "id" | "source" | "sourceName">
): NewsItem {
  return {
    id: `${source}:${fields.url}`,
    source,
    sourceName: SOURCE_NAMES[source],
    ...fields,
  };
}

export function fromRss(items: RssItem[], source: "et" | "bs"): NewsItem[] {
  return items.flatMap((entry) => {
    const url = safeUrl(entry.link || entry.guid);
    const publishedAt = parseFeedDate(entry.pubDate);
    if (!url || !entry.title || !publishedAt) return [];

    return [
      item(source, {
        title: clip(entry.title, 200),
        summary: clip(entry.description),
        url,
        kind: "news",
        publishedAt,
        symbols: [],
      }),
    ];
  });
}

/**
 * NSE announcements: the title is the company, and the description reads
 * "<Company> has informed the Exchange about … |SUBJECT: <subject>". The
 * subject makes the better headline.
 */
export function fromNse(items: RssItem[]): NewsItem[] {
  return items.flatMap((entry) => {
    const url = safeUrl(entry.link);
    const publishedAt = parseFeedDate(entry.pubDate);
    if (!url || !entry.title || !publishedAt) return [];

    const [body, subject] = entry.description.split(/\|\s*SUBJECT:\s*/i);

    return [
      item("nse", {
        title: clip(subject ? `${entry.title}: ${subject.trim()}` : entry.title, 200),
        summary: clip((body ?? "").trim()),
        url,
        kind: "filing",
        publishedAt,
        symbols: [],
      }),
    ];
  });
}

export function fromUpstox(
  byKey: Record<string, UpstoxNewsItem[]>,
  symbolByKey: Map<string, string>
): NewsItem[] {
  const merged = new Map<string, NewsItem>();

  for (const [key, entries] of Object.entries(byKey)) {
    const symbol = symbolByKey.get(key);

    for (const entry of entries) {
      const url = safeUrl(entry.article_link);
      const title = text(entry.heading);
      const ms = typeof entry.published_time === "number" ? entry.published_time : Number(entry.published_time);
      if (!url || !title || !Number.isFinite(ms) || ms <= 0) continue;

      // The same article is often returned for several stocks: keep one item
      // and collect every symbol it was filed under.
      const existing = merged.get(url);
      if (existing) {
        if (symbol && !existing.symbols.includes(symbol)) existing.symbols.push(symbol);
        continue;
      }

      merged.set(
        url,
        item("upstox", {
          title: clip(title, 200),
          summary: clip(text(entry.summary)),
          url,
          kind: "news",
          publishedAt: new Date(ms).toISOString(),
          symbols: symbol ? [symbol] : [],
        })
      );
    }
  }

  return [...merged.values()];
}

export function fromFinnhub(entries: FinnhubMarketNewsItem[]): NewsItem[] {
  return entries.flatMap((entry) => {
    const url = safeUrl(entry.url);
    const title = text(entry.headline);
    const seconds = typeof entry.datetime === "number" ? entry.datetime : NaN;
    if (!url || !title || !Number.isFinite(seconds) || seconds <= 0) return [];

    const publisher = text(entry.source);

    return [
      {
        ...item("finnhub", {
          title: clip(title, 200),
          summary: clip(text(entry.summary)),
          url,
          kind: "news" as const,
          publishedAt: new Date(seconds * 1000).toISOString(),
          symbols: text(entry.related)
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter((s) => /^[A-Z.]{1,10}$/.test(s)),
        }),
        // Finnhub aggregates other publishers; name the real one.
        sourceName: publisher ? `${publisher} · Finnhub` : SOURCE_NAMES.finnhub,
      },
    ];
  });
}

/**
 * Merge, drop stale and future-dated items (dead feeds keep serving 2024
 * headlines), remove duplicate headlines across sources, cap noisy sources,
 * newest first.
 */
export function finalise(items: NewsItem[], now: number): NewsItem[] {
  const seen = new Set<string>();
  const perSource = new Map<NewsSourceId, number>();

  return items
    .filter((entry) => {
      const time = Date.parse(entry.publishedAt);
      return now - time <= MAX_AGE_MS && time - now <= 60 * 60_000;
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .filter((entry) => {
      const key = entry.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter((entry) => {
      const count = (perSource.get(entry.source) ?? 0) + 1;
      perSource.set(entry.source, count);
      return count <= (MAX_PER_SOURCE[entry.source] ?? MAX_ITEMS);
    })
    .slice(0, MAX_ITEMS);
}

/* ------------------------------------------------------------------ */
/* Loaders                                                             */
/* ------------------------------------------------------------------ */

type SourceResult = { id: NewsSourceId; items: NewsItem[] | null };

async function loadRssSource(
  id: "et" | "bs" | "nse",
  deps: NewsDeps
): Promise<SourceResult> {
  const xml = await deps.fetchFeed(FEEDS[id]);
  if (xml === null) return { id, items: null };

  const parsed = parseRss(xml);
  return { id, items: id === "nse" ? fromNse(parsed) : fromRss(parsed, id) };
}

async function loadUpstoxSource(deps: NewsDeps): Promise<SourceResult> {
  try {
    const pairs = await Promise.all(
      UPSTOX_NEWS_SYMBOLS.map(async (symbol) => [symbol, await deps.resolveInstrumentKey(symbol)] as const)
    );

    const symbolByKey = new Map<string, string>();
    for (const [symbol, key] of pairs) if (key) symbolByKey.set(key, symbol);
    if (symbolByKey.size === 0) return { id: "upstox", items: null };

    const byKey = await deps.getUpstoxNewsForKeys([...symbolByKey.keys()]);
    return { id: "upstox", items: byKey ? fromUpstox(byKey, symbolByKey) : null };
  } catch (error) {
    // Missing UPSTOX_ACCESS_TOKEN throws; that is "unavailable".
    console.error("Upstox news unavailable:", error instanceof Error ? error.message : error);
    return { id: "upstox", items: null };
  }
}

async function loadFinnhubSource(deps: NewsDeps): Promise<SourceResult> {
  const entries = await deps.getMarketNews();
  return { id: "finnhub", items: entries ? fromFinnhub(entries) : null };
}

async function loadRegion(region: NewsRegion, deps: NewsDeps): Promise<NewsFeed> {
  const results =
    region === "india"
      ? await Promise.all([
          loadUpstoxSource(deps),
          loadRssSource("nse", deps),
          loadRssSource("et", deps),
          loadRssSource("bs", deps),
        ])
      : await Promise.all([loadFinnhubSource(deps)]);

  const now = deps.now();
  const items = finalise(results.flatMap((result) => result.items ?? []), now);

  const sources: NewsSourceStatus[] = results.map((result) => ({
    id: result.id,
    name: SOURCE_NAMES[result.id],
    ok: result.items !== null,
    count: items.filter((entry) => entry.source === result.id).length,
  }));

  return { region, items, sources, fetchedAt: new Date(now).toISOString() };
}

/**
 * A cached loader: one feed per region, reused for `ttlMs`, concurrent
 * callers share one load, and a feed where every source failed is not cached.
 */
export function createNewsLoader(
  deps: NewsDeps = DEFAULT_DEPS,
  ttlMs: number = NEWS_CACHE_TTL_MS
): (region: NewsRegion) => Promise<NewsFeed> {
  const cache = new Map<NewsRegion, { feed: NewsFeed; at: number }>();
  const inFlight = new Map<NewsRegion, Promise<NewsFeed>>();

  return async (region) => {
    const hit = cache.get(region);
    if (hit && deps.now() - hit.at < ttlMs) return hit.feed;

    const pending = inFlight.get(region);
    if (pending) return pending;

    const load = loadRegion(region, deps)
      .then((feed) => {
        if (feed.sources.some((source) => source.ok)) {
          cache.set(region, { feed, at: deps.now() });
        }
        return feed;
      })
      .finally(() => inFlight.delete(region));

    inFlight.set(region, load);
    return load;
  };
}

export const getMarketNewsFeed = createNewsLoader();
