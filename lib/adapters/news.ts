import { NewsArticle } from "../types/news";

/**
 * Upstox news timestamps are unix MILLISECONDS (verified live across four
 * symbols, e.g. 1790063368434), while the project's NewsArticle.datetime — and
 * the `datetime * 1000` in lib/agent/normalizers/news.ts — is unix SECONDS.
 * Every Upstox timestamp is therefore divided by 1000 before it is stored.
 */
const MILLISECONDS_PER_SECOND = 1000;

/**
 * Safety net for the unit conversion above.
 *
 * A seconds value for any realistic date is below 1e11 (1e11 seconds is the
 * year 5138); a milliseconds value is at least 1e12 (1e11 milliseconds is
 * 1973). Values at or above this threshold are treated as milliseconds. Without
 * it, a value that arrived already in seconds would be divided again and every
 * article would silently move to 1970.
 */
const MILLISECOND_THRESHOLD = 1e11;

/**
 * A news row as read off the Upstox feed, narrowed to the fields this adapter
 * reads. Declared structurally so a test fixture does not need UpstoxNewsItem.
 */
export interface UpstoxNewsRow {
  heading?: unknown;
  summary?: unknown;
  thumbnail?: unknown;
  article_link?: unknown;
  published_time?: unknown;
}

/**
 * Convert a Upstox published_time to unix seconds, or null.
 *
 * Accepts a number or a numeric string (the ratio endpoint of the same provider
 * returns numeric strings, so both are tolerated), and rejects anything that is
 * not a positive finite time. A null result means the timestamp cannot be
 * represented, never "0 seconds past the epoch".
 */
export function parseUpstoxPublishedTime(
  value: unknown
): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : NaN;

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return numeric >= MILLISECOND_THRESHOLD
    ? Math.floor(numeric / MILLISECONDS_PER_SECOND)
    : Math.floor(numeric);
}

/**
 * A stable numeric id derived from the article URL.
 *
 * Upstox supplies no article id, but NewsArticle.id is a required number and
 * the stock page uses it as a React key. Hashing the URL keeps the id stable
 * across refetches for the same article, which an array index would not.
 * lib/agent/normalizers/news.ts already falls back to the URL when a provider
 * gives no id; this is the same idea in the numeric shape this contract needs.
 */
export function newsIdFromUrl(url: string): number {
  let hash = 0;

  for (let i = 0; i < url.length; i++) {
    hash = (hash * 31 + url.charCodeAt(i)) | 0;
  }

  return Math.abs(hash);
}

/**
 * Map a Upstox instrument news feed onto the project's NewsArticle contract.
 *
 * An article is kept only if it can be attributed (a headline and a link) and
 * dated (a parsable published_time). That second rule is deliberate:
 * NewsArticle.datetime is a required number, so an article with no usable
 * timestamp has no faithful representation — substituting 0 would make a
 * recent article sort as the oldest. Every one of the live responses sampled
 * carried a valid timestamp, so this drops nothing in practice.
 */
export function normalizeUpstoxNews(
  rows: UpstoxNewsRow[] | null | undefined
): NewsArticle[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  const articles: NewsArticle[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;

    const headline =
      typeof row.heading === "string" ? row.heading.trim() : "";
    const url =
      typeof row.article_link === "string" ? row.article_link.trim() : "";

    // An article we can't attribute to a headline + link isn't usable.
    if (!headline || !url) continue;

    const datetime = parseUpstoxPublishedTime(row.published_time);

    if (datetime === null) continue;

    articles.push({
      id: newsIdFromUrl(url),
      headline,
      summary: typeof row.summary === "string" ? row.summary.trim() : "",
      // Upstox supplies a thumbnail for every article sampled; an article
      // without one is still news, so it is kept with an empty image rather
      // than dropped.
      image: typeof row.thumbnail === "string" ? row.thumbnail.trim() : "",
      // Upstox publishes this feed (article_link points at upstox.com/news) and
      // provides no separate publisher field, so the provider is the source.
      source: "Upstox",
      url,
      datetime,
    });
  }

  return articles;
}
