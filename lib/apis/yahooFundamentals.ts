/**
 * Yahoo Finance fundamentals that need no cookie or crumb (verified from this
 * server; the quote/quoteSummary endpoints answer 401):
 *
 *   /ws/fundamentals-timeseries   trailing-twelve-month diluted EPS and
 *                                 shares outstanding, each with its as-of date
 *   /v8/finance/chart events=div  dividends paid in the last 12 months
 *
 * Unofficial endpoints with no SLA: every failure is "not available", never a
 * guessed number. Results are cached for 6 hours (they change quarterly).
 */

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TIMEOUT_MS = 8_000;
const CACHE_MS = 6 * 60 * 60_000;

export type Dated = { value: number; asOf: string };

export type YahooFundamentals = {
  epsTtm: Dated | null;
  sharesOutstanding: Dated | null;
  currency: string | null;
};

export type YahooDividends = {
  /** Sum of dividends with an ex-date in the last 365 days, per share. */
  total12m: number;
  count: number;
  lastDate: string | null;
};

type SeriesPoint = { asOfDate?: unknown; currencyCode?: unknown; reportedValue?: { raw?: unknown } } | null;

/** The latest point of one timeseries type, if it has a positive finite value. */
function latest(result: Record<string, unknown> | undefined, type: string): (Dated & { currency: string | null }) | null {
  const points = (result?.[type] as SeriesPoint[] | undefined) ?? [];
  const valid = points
    .filter((p): p is NonNullable<SeriesPoint> => Boolean(p))
    .map((p) => ({
      value: typeof p.reportedValue?.raw === "number" ? p.reportedValue.raw : NaN,
      asOf: typeof p.asOfDate === "string" ? p.asOfDate : "",
      currency: typeof p.currencyCode === "string" ? p.currencyCode : null,
    }))
    .filter((p) => Number.isFinite(p.value) && p.value > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.asOf))
    .sort((a, b) => a.asOf.localeCompare(b.asOf));
  return valid.at(-1) ?? null;
}

export function parseFundamentalsTimeseries(body: unknown): YahooFundamentals {
  const results = ((body as { timeseries?: { result?: unknown[] } })?.timeseries?.result ?? []) as Record<string, unknown>[];
  const byType = (type: string) => results.find((r) => (r.meta as { type?: string[] } | undefined)?.type?.[0] === type);

  const eps = latest(byType("trailingDilutedEPS"), "trailingDilutedEPS");
  const quarterly = latest(byType("quarterlyOrdinarySharesNumber"), "quarterlyOrdinarySharesNumber");
  const annual = latest(byType("annualOrdinarySharesNumber"), "annualOrdinarySharesNumber");
  const shares = [quarterly, annual].filter((s): s is NonNullable<typeof s> => s !== null).sort((a, b) => b.asOf.localeCompare(a.asOf))[0] ?? null;

  return {
    epsTtm: eps ? { value: eps.value, asOf: eps.asOf } : null,
    sharesOutstanding: shares ? { value: shares.value, asOf: shares.asOf } : null,
    currency: eps?.currency ?? null,
  };
}

export function parseDividends(body: unknown, now: number): YahooDividends | null {
  const result = (body as { chart?: { result?: { events?: { dividends?: Record<string, unknown> } }[] } })?.chart?.result?.[0];
  if (!result) return null;
  const cutoff = now / 1000 - 365 * 86_400;
  const paid = Object.values(result.events?.dividends ?? {})
    .map((d) => d as { amount?: unknown; date?: unknown })
    .filter((d) => typeof d.amount === "number" && d.amount > 0 && typeof d.date === "number" && d.date >= cutoff && d.date <= now / 1000)
    .sort((a, b) => (a.date as number) - (b.date as number));
  return {
    total12m: Math.round(paid.reduce((sum, d) => sum + (d.amount as number), 0) * 10_000) / 10_000,
    count: paid.length,
    lastDate: paid.length > 0 ? new Date((paid[paid.length - 1].date as number) * 1000).toISOString().slice(0, 10) : null,
  };
}

const fundamentalsCache = new Map<string, { at: number; value: YahooFundamentals | null }>();
const dividendsCache = new Map<string, { at: number; value: YahooDividends | null }>();

async function fetchJson(url: string, fetcher: typeof fetch): Promise<unknown | null> {
  try {
    const response = await fetcher(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`Yahoo fundamentals ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error("Yahoo fundamentals error:", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

export async function getYahooFundamentals(yahooSymbol: string, fetcher: typeof fetch = fetch, now: number = Date.now()): Promise<YahooFundamentals | null> {
  const hit = fundamentalsCache.get(yahooSymbol);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  const params = new URLSearchParams({
    type: "trailingDilutedEPS,quarterlyOrdinarySharesNumber,annualOrdinarySharesNumber",
    period1: String(Math.floor(now / 1000) - 3 * 365 * 86_400),
    period2: String(Math.floor(now / 1000)),
  });
  const body = await fetchJson(
    `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(yahooSymbol)}?${params.toString()}`,
    fetcher
  );
  const value = body ? parseFundamentalsTimeseries(body) : null;
  // Failures are not cached, so a provider hiccup is retried on the next view.
  if (value) fundamentalsCache.set(yahooSymbol, { at: now, value });
  return value;
}

export async function getYahooDividends(yahooSymbol: string, fetcher: typeof fetch = fetch, now: number = Date.now()): Promise<YahooDividends | null> {
  const hit = dividendsCache.get(yahooSymbol);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  const body = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1y&interval=1d&events=div`,
    fetcher
  );
  const value = body ? parseDividends(body, now) : null;
  if (value) dividendsCache.set(yahooSymbol, { at: now, value });
  return value;
}
