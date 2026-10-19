/**
 * Fetch a public RSS feed as text. Null on any failure — a feed being down is
 * "this source is unavailable", never an error page.
 */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export async function fetchFeed(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      console.error(`Feed ${response.status}: ${url}`);
      return null;
    }

    return await response.text();
  } catch (error) {
    console.error(`Feed error: ${url}`, error instanceof Error ? error.message : error);
    return null;
  }
}
