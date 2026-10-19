/**
 * Yahoo Finance chart endpoint, called directly.
 *
 * yahoo-finance2's quote() goes through Yahoo's /v7/finance/quote, which needs
 * a cookie + crumb and is rate-limited per IP (HTTP 429) — on this machine it
 * refused every request. The /v8/finance/chart endpoint needs neither and still
 * answers, and its `meta` block carries everything an index row needs: price,
 * previous close, day high/low, currency and Yahoo's own market timestamp.
 *
 * This is an unofficial endpoint with no SLA. It is used only for global
 * indices (no free official source carries them); every failure is reported as
 * "no quote" and the page shows the market as unavailable.
 */

export type ChartQuote = {
  price: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  currency: string | null;
  /** When Yahoo last priced it (ISO), not when we fetched it. */
  marketTime: string | null;
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const TIMEOUT_MS = 8_000;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Pull a quote out of a chart response body; null when it holds no price. */
export function parseChartQuote(body: unknown): ChartQuote | null {
  const result = (body as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | {
        meta?: Record<string, unknown>;
        indicators?: { quote?: { open?: unknown[] }[] };
      }
    | undefined;

  const meta = result?.meta;
  const price = num(meta?.regularMarketPrice);
  if (!meta || price === null) return null;

  const previousClose = num(meta.chartPreviousClose) ?? num(meta.previousClose);
  const change = previousClose !== null ? price - previousClose : null;

  const opens = result?.indicators?.quote?.[0]?.open ?? [];
  const open = num(opens[opens.length - 1]) ?? num(meta.regularMarketOpen);

  const time = num(meta.regularMarketTime);

  return {
    price,
    change,
    changePercent:
      change !== null && previousClose ? (change / previousClose) * 100 : null,
    open,
    high: num(meta.regularMarketDayHigh),
    low: num(meta.regularMarketDayLow),
    previousClose,
    currency: typeof meta.currency === "string" ? meta.currency : null,
    marketTime: time !== null ? new Date(time * 1000).toISOString() : null,
  };
}

export async function getYahooChartQuote(symbol: string): Promise<ChartQuote | null> {
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
      {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );

    if (!response.ok) {
      console.error(`Yahoo chart ${response.status} for ${symbol}`);
      return null;
    }

    return parseChartQuote(await response.json());
  } catch (error) {
    console.error(
      `Yahoo chart error for ${symbol}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/**
 * Several symbols, one request each, in parallel. A symbol that failed is
 * simply absent; null only when every one failed.
 */
export async function getYahooChartQuotes(
  symbols: string[]
): Promise<Record<string, ChartQuote> | null> {
  const results = await Promise.all(
    symbols.map(async (symbol) => [symbol, await getYahooChartQuote(symbol)] as const)
  );

  const found = results.filter(
    (entry): entry is readonly [string, ChartQuote] => entry[1] !== null
  );

  return found.length > 0 ? Object.fromEntries(found) : null;
}

/* ------------------------------------------------------------------ */
/* Candles (price history)                                             */
/* ------------------------------------------------------------------ */

export type Candle = {
  /** Epoch milliseconds. */
  t: number;
  o: number | null;
  h: number | null;
  l: number | null;
  c: number;
  v: number | null;
};

export type ChartSeries = {
  name: string | null;
  currency: string | null;
  exchangeTimezone: string | null;
  previousClose: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  regularMarketPrice: number | null;
  marketTime: string | null;
  /** The exchange's regular session (epoch ms), for a full-day 1D axis. */
  sessionStart: number | null;
  sessionEnd: number | null;
  candles: Candle[];
};

/** Turn a chart response into candles; points with no close are dropped. */
export function parseChartSeries(body: unknown): ChartSeries | null {
  const result = (body as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | {
        meta?: Record<string, unknown>;
        timestamp?: unknown[];
        indicators?: {
          quote?: { open?: unknown[]; high?: unknown[]; low?: unknown[]; close?: unknown[]; volume?: unknown[] }[];
        };
      }
    | undefined;

  if (!result?.meta) return null;

  const meta = result.meta;
  const times = Array.isArray(result.timestamp) ? result.timestamp : [];
  const q = result.indicators?.quote?.[0] ?? {};

  const candles: Candle[] = [];
  times.forEach((time, i) => {
    const t = num(time);
    const c = num(q.close?.[i]);
    if (t === null || c === null) return;
    candles.push({
      t: t * 1000,
      o: num(q.open?.[i]),
      h: num(q.high?.[i]),
      l: num(q.low?.[i]),
      c,
      v: num(q.volume?.[i]),
    });
  });

  const time = num(meta.regularMarketTime);
  const name =
    (typeof meta.longName === "string" && meta.longName.trim()) ||
    (typeof meta.shortName === "string" && meta.shortName.trim()) ||
    null;

  return {
    name,
    currency: typeof meta.currency === "string" ? meta.currency : null,
    exchangeTimezone: typeof meta.exchangeTimezoneName === "string" ? meta.exchangeTimezoneName : null,
    previousClose: num(meta.chartPreviousClose) ?? num(meta.previousClose),
    fiftyTwoWeekHigh: num(meta.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: num(meta.fiftyTwoWeekLow),
    regularMarketPrice: num(meta.regularMarketPrice),
    marketTime: time !== null ? new Date(time * 1000).toISOString() : null,
    ...regularSession(meta),
    candles,
  };
}

function regularSession(meta: Record<string, unknown>): { sessionStart: number | null; sessionEnd: number | null } {
  const regular = (meta.currentTradingPeriod as { regular?: { start?: unknown; end?: unknown } } | undefined)?.regular;
  const start = num(regular?.start);
  const end = num(regular?.end);
  return start !== null && end !== null && end > start
    ? { sessionStart: start * 1000, sessionEnd: end * 1000 }
    : { sessionStart: null, sessionEnd: null };
}

export async function getYahooSeries(
  symbol: string,
  range: string,
  interval: string
): Promise<ChartSeries | null> {
  try {
    const params = new URLSearchParams({ range, interval, includePrePost: "false" });
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params.toString()}`,
      {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );

    if (!response.ok) {
      console.error(`Yahoo series ${response.status} for ${symbol}`);
      return null;
    }

    return parseChartSeries(await response.json());
  } catch (error) {
    console.error(`Yahoo series error for ${symbol}:`, error instanceof Error ? error.message : error);
    return null;
  }
}
