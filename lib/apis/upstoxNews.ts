import { upstoxFetch } from "./upstoxGate";
const ACCESS_TOKEN = process.env.UPSTOX_ACCESS_TOKEN;

/**
 * One article from Upstox's instrument news feed.
 *
 * Every field is optional and typed `unknown` because this is an upstream
 * response we do not control; lib/adapters/news.ts is what validates it.
 */
export interface UpstoxNewsItem {
  heading?: unknown;
  summary?: unknown;
  thumbnail?: unknown;
  article_link?: unknown;
  published_time?: unknown;
}

/**
 * News for a single NSE instrument, keyed by its Upstox instrument_key
 * (e.g. "NSE_EQ|INE467B01029") — not by ISIN and not by an NSE trading symbol.
 *
 * Upstox requires `instrument_keys` when category=instrument_keys (a bare
 * `symbols=` parameter is rejected) and rejects a bare ISIN with UDAPI1087
 * ("One of either symbol or instrument_key is invalid"), so the caller must
 * resolve the instrument through searchUpstoxEquity() first.
 *
 * Returns:
 *  - an array (possibly empty) when Upstox answered successfully. An empty
 *    array means "no news for this instrument", which is a real answer.
 *  - null when the request failed or the response was not in the expected
 *    shape, i.e. when we do not know whether there is news.
 * Throws if UPSTOX_ACCESS_TOKEN is missing (same convention as the other
 * Upstox clients).
 */
export async function getUpstoxNews(
  instrumentKey: string
): Promise<UpstoxNewsItem[] | null> {
  if (!ACCESS_TOKEN) {
    throw new Error(
      "UPSTOX_ACCESS_TOKEN is missing from environment variables"
    );
  }

  const trimmedKey = instrumentKey.trim();

  if (!trimmedKey) {
    return null;
  }

  try {
    const params = new URLSearchParams({
      category: "instrument_keys",
      instrument_keys: trimmedKey,
    });

    const response = await upstoxFetch(
      `https://api.upstox.com/v2/news?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        `Upstox News Error ${response.status}:`,
        errorText
      );

      return null;
    }

    const data = await response.json();

    // The documented envelope is { status: "success", data: { <key>: [...] } }.
    // Anything else is a response we cannot read, which is "unavailable", not
    // "no news".
    if (
      data?.status !== "success" ||
      !data?.data ||
      typeof data.data !== "object" ||
      Array.isArray(data.data)
    ) {
      return null;
    }

    const bucket: unknown = (data.data as Record<string, unknown>)[trimmedKey];

    // A successful response with no news omits the key entirely (data: {}),
    // which is an empty feed rather than a failure.
    if (bucket === undefined || bucket === null) {
      return [];
    }

    if (!Array.isArray(bucket)) {
      return null;
    }

    // Built field by field so nothing else on the upstream row can travel
    // further than these five documented fields.
    const items: UpstoxNewsItem[] = [];

    for (const row of bucket) {
      if (!row || typeof row !== "object") continue;

      const entry = row as Record<string, unknown>;

      items.push({
        heading: entry.heading,
        summary: entry.summary,
        thumbnail: entry.thumbnail,
        article_link: entry.article_link,
        published_time: entry.published_time,
      });
    }

    return items;
  } catch (error) {
    console.error(
      `Upstox News Error [${trimmedKey}]:`,
      error
    );

    return null;
  }
}

/**
 * News for up to 30 instruments in one request, keyed by instrument key.
 *
 * Upstox has no market-wide news category (only instrument_keys, positions and
 * holdings), so the Market News page asks for the Nifty 50's largest names
 * this way. Same validation as getUpstoxNews(): null when the response cannot
 * be read; a key with no news is simply absent.
 */
export async function getUpstoxNewsForKeys(
  instrumentKeys: string[]
): Promise<Record<string, UpstoxNewsItem[]> | null> {
  if (!ACCESS_TOKEN) {
    throw new Error("UPSTOX_ACCESS_TOKEN is missing from environment variables");
  }

  const keys = instrumentKeys.map((key) => key.trim()).filter(Boolean).slice(0, 30);
  if (keys.length === 0) return {};

  try {
    const params = new URLSearchParams({
      category: "instrument_keys",
      instrument_keys: keys.join(","),
      page_size: "100",
    });

    const response = await upstoxFetch(`https://api.upstox.com/v2/news?${params.toString()}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error(`Upstox News Error ${response.status}:`, await response.text());
      return null;
    }

    const data = await response.json();

    if (
      data?.status !== "success" ||
      !data?.data ||
      typeof data.data !== "object" ||
      Array.isArray(data.data)
    ) {
      return null;
    }

    const result: Record<string, UpstoxNewsItem[]> = {};

    for (const key of keys) {
      const bucket: unknown = (data.data as Record<string, unknown>)[key];
      if (!Array.isArray(bucket)) continue;

      result[key] = bucket
        .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
        .map((entry) => ({
          heading: entry.heading,
          summary: entry.summary,
          thumbnail: entry.thumbnail,
          article_link: entry.article_link,
          published_time: entry.published_time,
        }));
    }

    return result;
  } catch (error) {
    console.error("Upstox News Error [multi]:", error);
    return null;
  }
}
