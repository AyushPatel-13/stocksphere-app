/**
 * Yahoo Finance spark endpoint: close series for up to 20 symbols per call,
 * no cookie or crumb (verified from this server). Used by the Heatmap so a
 * 500-stock universe is 25 requests, not 500.
 *
 *   /v7/finance/spark?symbols=A,B&range=2y&interval=1d   daily closes
 *   ...&range=1d&interval=1m&includePrePost=true          today's minute bars
 *
 * Only closes are returned (no volume, even when asked). The meta block
 * carries the exchange time zone and the current trading periods, which the
 * metric code needs to place session boundaries correctly.
 *
 * Unofficial endpoint, no SLA: a failed batch leaves its symbols out.
 */

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TIMEOUT_MS = 12_000;
export const SPARK_BATCH = 20;
const CONCURRENCY = 4;

export type Period = { start: number; end: number };

export type SparkSeries = {
  symbol: string;
  /** IANA zone of the listing exchange, e.g. "Asia/Kolkata". */
  timeZone: string | null;
  /** Bar start times, ms since epoch, ascending, aligned with `closes`. */
  times: number[];
  closes: number[];
  /** Previous session's close as Yahoo reports it for a 1-day range. */
  previousClose: number | null;
  regularMarketPrice: number | null;
  regularMarketTime: number | null;
  /** Today's (or the latest) session periods, ms since epoch. */
  periods: { pre: Period | null; regular: Period | null; post: Period | null };
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function period(raw: unknown): Period | null {
  const p = raw as { start?: unknown; end?: unknown } | undefined;
  const start = num(p?.start);
  const end = num(p?.end);
  return start !== null && end !== null && end >= start ? { start: start * 1000, end: end * 1000 } : null;
}

/** Parse one spark response body into series keyed by symbol. */
export function parseSpark(body: unknown): Map<string, SparkSeries> {
  const out = new Map<string, SparkSeries>();
  const results = (body as { spark?: { result?: unknown[] } })?.spark?.result ?? [];
  for (const raw of results) {
    const r = raw as { symbol?: unknown; response?: unknown[] };
    const res = r.response?.[0] as
      | { meta?: Record<string, unknown>; timestamp?: unknown[]; indicators?: { quote?: { close?: unknown[] }[] } }
      | undefined;
    if (typeof r.symbol !== "string" || !res?.meta) continue;
    const ts = res.timestamp ?? [];
    const cs = res.indicators?.quote?.[0]?.close ?? [];
    const times: number[] = [];
    const closes: number[] = [];
    for (let i = 0; i < ts.length; i++) {
      const t = num(ts[i]);
      const c = num(cs[i]);
      // Null closes are gaps in Yahoo's data, not zero prices.
      if (t !== null && c !== null && c > 0) {
        times.push(t * 1000);
        closes.push(c);
      }
    }
    const meta = res.meta;
    const tp = meta.currentTradingPeriod as Record<string, unknown> | undefined;
    const time = num(meta.regularMarketTime);
    out.set(r.symbol, {
      symbol: r.symbol,
      timeZone: typeof meta.exchangeTimezoneName === "string" ? meta.exchangeTimezoneName : null,
      times,
      closes,
      previousClose: num(meta.chartPreviousClose),
      regularMarketPrice: num(meta.regularMarketPrice),
      regularMarketTime: time !== null ? time * 1000 : null,
      periods: { pre: period(tp?.pre), regular: period(tp?.regular), post: period(tp?.post) },
    });
  }
  return out;
}

export async function getSparkBatch(
  symbols: readonly string[],
  params: { range: string; interval: string; prePost?: boolean },
  fetcher: typeof fetch = fetch
): Promise<Map<string, SparkSeries>> {
  const query = new URLSearchParams({ symbols: symbols.join(","), range: params.range, interval: params.interval });
  if (params.prePost) query.set("includePrePost", "true");
  try {
    const response = await fetcher(`https://query1.finance.yahoo.com/v7/finance/spark?${query.toString()}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`Yahoo spark ${response.status}`);
      return new Map();
    }
    return parseSpark(await response.json());
  } catch (error) {
    console.error("Yahoo spark error:", error instanceof Error ? error.message : "unknown");
    return new Map();
  }
}

/** Any number of symbols, in batches of SPARK_BATCH, a few batches at a time. */
export async function getSpark(
  symbols: readonly string[],
  params: { range: string; interval: string; prePost?: boolean },
  fetcher: typeof fetch = fetch
): Promise<Map<string, SparkSeries>> {
  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += SPARK_BATCH) batches.push(symbols.slice(i, i + SPARK_BATCH));
  const out = new Map<string, SparkSeries>();
  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
      for (const [k, v] of await getSparkBatch(batch, params, fetcher)) out.set(k, v);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  return out;
}
