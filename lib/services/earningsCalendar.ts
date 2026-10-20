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
let cache: { key: string; at: number; events: EarningsEvent[] } | null = null;

export async function getEarningsCalendar(
  from: string,
  to: string,
  fetcher: typeof fetch = fetch,
  apiKey: string | undefined = process.env.FINNHUB_API_KEY
): Promise<EarningsEvent[] | null> {
  if (!apiKey) return null;
  const key = `${from}|${to}`;
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.events;

  try {
    const params = new URLSearchParams({ from, to, token: apiKey });
    const response = await fetcher(`https://finnhub.io/api/v1/calendar/earnings?${params.toString()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      console.error(`Finnhub earnings calendar ${response.status}`);
      return null;
    }
    const events = parseEarnings(await response.json());
    cache = { key, at: Date.now(), events };
    return events;
  } catch (error) {
    console.error("Finnhub earnings calendar error:", error instanceof Error ? error.message : "unknown");
    return null;
  }
}
