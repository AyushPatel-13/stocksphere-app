/**
 * A US company's industry from Finnhub's profile2 endpoint (`finnhubIndustry`,
 * Finnhub's own classification). Kept apart from lib/apis/finnhub.ts's
 * getCompanyProfile, which logs the whole response on every call.
 *
 * Cached for a day; failures aren't cached and come back as null.
 */

const CACHE_MS = 24 * 60 * 60_000;
const cache = new Map<string, { at: number; value: string | null }>();

export async function getFinnhubIndustry(symbol: string, fetcher: typeof fetch = fetch, now: number = Date.now()): Promise<string | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  const hit = cache.get(symbol);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  try {
    const response = await fetcher(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { finnhubIndustry?: unknown };
    const value = typeof body?.finnhubIndustry === "string" && body.finnhubIndustry.trim() !== "" ? body.finnhubIndustry.trim() : null;
    cache.set(symbol, { at: now, value });
    return value;
  } catch {
    return null;
  }
}
