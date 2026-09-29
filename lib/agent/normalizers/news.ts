import { NormalizedNewsArticle } from "../types";

const MAX_ARTICLES = 10;

/**
 * Normalizes whatever lib/services/news.ts returns (currently a raw
 * Finnhub company-news array) into a stable, agent-facing shape.
 *
 * Defensive by design: this normalizer does not know or trust the exact
 * upstream provider shape, so every field is checked before use. An
 * article missing a headline or URL is dropped rather than passed through
 * with fabricated placeholders.
 */
export function normalizeNews(raw: unknown): NormalizedNewsArticle[] {
  if (!Array.isArray(raw)) return [];

  const seenUrls = new Set<string>();
  const articles: NormalizedNewsArticle[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    const record = item as Record<string, unknown>;

    const headline =
      typeof record.headline === "string" ? record.headline.trim() : "";
    const url = typeof record.url === "string" ? record.url.trim() : "";

    // An article we can't attribute to a headline + link isn't usable.
    if (!headline || !url) continue;
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    let publishedAt: string | null = null;
    if (typeof record.datetime === "number" && Number.isFinite(record.datetime)) {
      // Finnhub returns unix seconds.
      publishedAt = new Date(record.datetime * 1000).toISOString();
    }

    const idSource = record.id;
    const id =
      typeof idSource === "number" || typeof idSource === "string"
        ? String(idSource)
        : url;

    articles.push({
      id,
      headline,
      summary: typeof record.summary === "string" ? record.summary.trim() : "",
      url,
      source:
        typeof record.source === "string" && record.source.trim()
          ? record.source.trim()
          : "Unknown",
      publishedAt,
    });
  }

  articles.sort((a, b) => {
    if (!a.publishedAt && !b.publishedAt) return 0;
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;
    return b.publishedAt.localeCompare(a.publishedAt);
  });

  return articles.slice(0, MAX_ARTICLES);
}
