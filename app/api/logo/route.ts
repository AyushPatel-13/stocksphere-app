/**
 * GET /api/logo?s=RELIANCE.NS — a company/coin logo, proxied and cached.
 *
 * `s` is the provider symbol produced by lib/logos.ts (e.g. "TCS.NS", "AAPL",
 * "BTCUSD"). 404 when there is no logo, so the UI shows its initial instead.
 * Logos change rarely: hits are cached in memory and browsers/CDNs may keep
 * them for a week; misses are remembered for a day.
 */

const SOURCE_SYMBOL = /^[A-Z0-9][A-Z0-9.&-]{0,24}$/;
const HIT_TTL_MS = 7 * 86_400_000;
const MISS_TTL_MS = 86_400_000;
const MAX_ENTRIES = 2_000;
const MAX_BYTES = 200_000;

type Entry = { at: number; body: ArrayBuffer | null; type: string };
const cache = new Map<string, Entry>();

export type LogoFetcher = (symbol: string) => Promise<{ body: ArrayBuffer; type: string } | null>;

async function fetchFromFmp(symbol: string): Promise<{ body: ArrayBuffer; type: string } | null> {
  try {
    const response = await fetch(
      `https://financialmodelingprep.com/image-stock/${encodeURIComponent(symbol)}.png`,
      { cache: "no-store", signal: AbortSignal.timeout(6_000) }
    );
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.startsWith("image/")) return null;

    const body = await response.arrayBuffer();
    return body.byteLength > 0 && body.byteLength <= MAX_BYTES ? { body, type } : null;
  } catch {
    return null;
  }
}

function remember(key: string, entry: Entry) {
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, entry);
}

export async function GET(
  request: Request,
  _context?: unknown,
  fetchLogo: LogoFetcher = fetchFromFmp,
  now: number = Date.now()
) {
  const symbol = new URL(request.url).searchParams.get("s")?.trim().toUpperCase() ?? "";
  if (!SOURCE_SYMBOL.test(symbol)) return new Response("Invalid symbol", { status: 400 });

  let entry = cache.get(symbol);
  const fresh = entry && now - entry.at < (entry.body ? HIT_TTL_MS : MISS_TTL_MS);

  if (!fresh) {
    const logo = await fetchLogo(symbol);
    entry = { at: now, body: logo?.body ?? null, type: logo?.type ?? "" };
    remember(symbol, entry);
  }

  if (!entry?.body) {
    return new Response("No logo", { status: 404, headers: { "Cache-Control": "public, max-age=86400" } });
  }

  return new Response(entry.body, {
    headers: {
      "Content-Type": entry.type,
      "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
