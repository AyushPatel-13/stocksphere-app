/**
 * Upcoming earnings dates from Finnhub's earnings calendar (free tier: US
 * listings). Each entry is labelled with its source; estimates are the
 * provider's consensus figures, shown as such, and missing values stay null.
 *
 * Indian results dates aren't available from StockSphere's free sources, so
 * the events page says so rather than showing a partial list as complete.
 */

export type EarningsEvent = {
  symbol: string;
  date: string;
  /** "bmo" before market open, "amc" after market close, "dmh" during hours. */
  hour: "bmo" | "amc" | "dmh" | null;
  quarter: number | null;
  year: number | null;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
  source: "Finnhub";
};

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseEarnings(body: unknown): EarningsEvent[] {
  const rows = (body as { earningsCalendar?: unknown[] } | null)?.earningsCalendar;
  if (!Array.isArray(rows)) return [];

  return rows
    .flatMap((raw): EarningsEvent[] => {
      const row = raw as Record<string, unknown>;
      const symbol = typeof row.symbol === "string" ? row.symbol.toUpperCase() : "";
      const date = typeof row.date === "string" ? row.date : "";
      if (!SYMBOL.test(symbol) || !DATE.test(date)) return [];
      const hour: EarningsEvent["hour"] = row.hour === "bmo" || row.hour === "amc" || row.hour === "dmh" ? row.hour : null;
      return [
        {
          symbol,
          date,
          hour,
          quarter: num(row.quarter),
          year: num(row.year),
          epsEstimate: num(row.epsEstimate),
          epsActual: num(row.epsActual),
          revenueEstimate: num(row.revenueEstimate),
          revenueActual: num(row.revenueActual),
          source: "Finnhub" as const,
        },
      ];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
}

const CACHE_MS = 60 * 60_000;
const cache = new Map<string, { at: number; events: EarningsEvent[] }>();
const MAX_CACHE = 100;

/**
 * Finnhub returns at most 1,500 events per request (verified: a 30-day window
 * came back with exactly 1,500 and silently left out Apple and Microsoft). So a
 * long window is fetched one week at a time, and a single company is asked
 * for by symbol.
 */
export const FINNHUB_EVENT_CAP = 1500;
const CHUNK_DAYS = 7;

export function weeklyWindows(from: string, to: string): [string, string][] {
  const day = 86_400_000;
  const end = Date.parse(`${to}T00:00:00Z`);
  const windows: [string, string][] = [];
  for (let start = Date.parse(`${from}T00:00:00Z`); start <= end; start += CHUNK_DAYS * day) {
    const stop = Math.min(start + (CHUNK_DAYS - 1) * day, end);
    windows.push([new Date(start).toISOString().slice(0, 10), new Date(stop).toISOString().slice(0, 10)]);
  }
  return windows;
}

async function fetchWindow(from: string, to: string, symbol: string | null, fetcher: typeof fetch, apiKey: string): Promise<EarningsEvent[] | null> {
  const params = new URLSearchParams({ from, to, token: apiKey });
  if (symbol) params.set("symbol", symbol);
  const response = await fetcher(`https://finnhub.io/api/v1/calendar/earnings?${params.toString()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    console.error(`Finnhub earnings calendar ${response.status}`);
    return null;
  }
  const events = parseEarnings(await response.json());
  if (!symbol && events.length >= FINNHUB_EVENT_CAP) console.error(`Finnhub earnings calendar hit its ${FINNHUB_EVENT_CAP}-event cap for ${from}..${to}`);
  return events;
}

export async function getEarningsCalendar(
  from: string,
  to: string,
  fetcher: typeof fetch = fetch,
  apiKey: string | undefined = process.env.FINNHUB_API_KEY,
  symbol: string | null = null
): Promise<EarningsEvent[] | null> {
  if (!apiKey) return null;
  const key = `${from}|${to}|${symbol ?? "*"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.events;

  try {
    const parts = symbol
      ? [await fetchWindow(from, to, symbol.toUpperCase(), fetcher, apiKey)]
      : await Promise.all(weeklyWindows(from, to).map(([a, b]) => fetchWindow(a, b, null, fetcher, apiKey)));
    if (parts.some((p) => p === null)) return null;

    const seen = new Set<string>();
    const events = parts
      .flat()
      .filter((e): e is EarningsEvent => e !== null && (!symbol || e.symbol === symbol.toUpperCase()))
      .filter((e) => !seen.has(`${e.symbol}|${e.date}`) && Boolean(seen.add(`${e.symbol}|${e.date}`)))
      .sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));

    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), events });
    return events;
  } catch (error) {
    console.error("Finnhub earnings calendar error:", error instanceof Error ? error.message : "unknown");
    return null;
  }
}
