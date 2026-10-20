/**
 * A short company description from Wikipedia's REST summary endpoint, used
 * when the market-data provider has none (Upstox carries no descriptions).
 *
 * Shown with attribution and a link to the article. A page is accepted only
 * when it is a normal article (not a disambiguation page) whose text reads
 * like a company — otherwise nothing is shown rather than the wrong page.
 * Cached for 24 hours.
 */

export type CompanySummary = { text: string; url: string; title: string };

const CACHE_MS = 24 * 60 * 60_000;
const TIMEOUT_MS = 6_000;
const MAX_CHARS = 700;

const COMPANY_WORDS = /\b(company|corporation|conglomerate|multinational|bank|manufacturer|enterprise|firm|group|limited|ltd|inc\.?|incorporated|holding|provider|producer|retailer|insurer|lender|operator|developer|maker)\b/i;

const LEGAL_SUFFIX = /\s*\b(limited|ltd\.?|inc\.?|incorporated|corporation|corp\.?|plc|co\.?)\s*$/i;

/** Titles to try, most specific first: "Reliance Industries Limited", "Reliance Industries". */
export function candidateTitles(name: string): string[] {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const stripped = clean.replace(LEGAL_SUFFIX, "").trim();
  return Array.from(new Set([clean, stripped].filter((t) => t.length >= 2)));
}

/** Trim to whole sentences within MAX_CHARS. */
export function trimSummary(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_CHARS) return flat;
  const cut = flat.slice(0, MAX_CHARS);
  const end = cut.lastIndexOf(". ");
  return end > 200 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

export function acceptSummary(body: unknown, companyName: string): CompanySummary | null {
  const page = body as { type?: unknown; extract?: unknown; title?: unknown; description?: unknown; content_urls?: { desktop?: { page?: unknown } } } | null;
  if (!page || page.type !== "standard" || typeof page.extract !== "string" || typeof page.title !== "string") return null;
  const url = page.content_urls?.desktop?.page;
  if (typeof url !== "string" || !url.startsWith("https://en.wikipedia.org/")) return null;

  const about = `${typeof page.description === "string" ? page.description : ""} ${page.extract.slice(0, 300)}`;
  if (!COMPANY_WORDS.test(about)) return null;

  // The article must be about this name: its first word appears in the title.
  const firstWord = companyName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (firstWord.length >= 2 && !page.title.toLowerCase().includes(firstWord)) return null;

  return { text: trimSummary(page.extract), url, title: page.title };
}

const cache = new Map<string, { at: number; value: CompanySummary | null }>();

export async function getCompanySummary(
  companyName: string,
  fetcher: typeof fetch = fetch,
  now: number = Date.now()
): Promise<CompanySummary | null> {
  const key = companyName.trim().toLowerCase();
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  let found: CompanySummary | null = null;
  let answered = false;
  for (const title of candidateTitles(companyName)) {
    try {
      const response = await fetcher(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}?redirect=true`, {
        headers: { "User-Agent": "StockSphere/1.0 (company overview)", Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 404) {
        answered = true;
        continue;
      }
      if (!response.ok) continue;
      answered = true;
      found = acceptSummary(await response.json(), companyName);
      if (found) break;
    } catch {
      /* try the next title */
    }
  }

  // Remember a definite answer (found or not found); retry after errors.
  if (answered) cache.set(key, { at: now, value: found });
  return found;
}
