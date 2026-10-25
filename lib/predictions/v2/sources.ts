import { getUpstoxQuotes, searchUpstoxEquity } from "../../apis/upstox";
import { getYahooSeries, type Candle, type ChartSeries } from "../../apis/yahooChart";
import { INDIAN_INDICES } from "../../data/instruments/indices";
import { getHistory, resolveAsset, type History, type ResolvedAsset } from "../../services/history";
import { SCORING_V2, type ScoringConfig } from "./config";
import type { LastClose, LiveQuote, PredictionAssetKind, SessionInfo } from "./reference";

/**
 * What the server knows about an asset at the moment of a prediction, read
 * from the providers StockSphere already uses:
 *
 *   live quote   Upstox last traded price (Indian stocks, ETFs, indices),
 *                or for rupee crypto the dollar pair converted at USD/INR,
 *                then the last Yahoo 1-minute bar
 *   session      Yahoo's current regular trading period
 *   daily closes Yahoo daily bars (Upstox daily bars when Yahoo fails)
 *
 * Every failure becomes "not available"; nothing is estimated here.
 */

export type MarketSnapshot = {
  symbol: string;
  currency: string | null;
  session: SessionInfo;
  live: LiveQuote[];
  lastClose: LastClose;
  /** Completed daily closes, oldest first. */
  dailyCloses: number[];
};

export interface PredictionMarketData {
  snapshot(assetType: PredictionAssetKind, symbol: string, now: number): Promise<MarketSnapshot | null>;
}

const toNumber = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/**
 * The live price from an Upstox quote response, matched on instrument_token
 * (Upstox keys the response by its own symbol string). Only last_trade_time
 * is trusted as the quote time; without it the quote isn't used.
 */
export function parseUpstoxLiveQuote(raw: unknown, instrumentKey: string): LiveQuote | null {
  const data = raw && typeof raw === "object" ? (raw as { data?: unknown }).data : undefined;
  if (!data || typeof data !== "object") return null;

  const quote = (Object.values(data) as { instrument_token?: unknown; last_price?: unknown; last_trade_time?: unknown }[]).find(
    (entry) => entry?.instrument_token === instrumentKey
  );
  const price = toNumber(quote?.last_price);
  const time = toNumber(quote?.last_trade_time);
  return price !== null && price > 0 && time !== null && time > 0 ? { price, quoteTime: time, source: "upstox" } : null;
}

/** The newest 1-minute bar as a live quote, timed at its bar start (conservative). */
export function yahooLiveQuote(intraday: History | null): LiveQuote | null {
  const last = intraday?.candles.at(-1);
  return last && last.c > 0 ? { price: last.c, quoteTime: last.t, source: "yahoo" } : null;
}

/** How far a converted rupee price may sit from Yahoo's own INR pair before it isn't trusted. */
export const MAX_CONVERSION_GAP = 0.02;

/**
 * A crypto rupee price from the coin's dollar pair and the USD/INR rate, both
 * Yahoo's own latest price and time (chart meta).
 *
 * Yahoo's INR crypto pairs are exactly this product (checked 2026-10-24: every
 * coin within 0.3% of USD × USDINR=X), but Yahoo refreshes them in batches
 * every two to four minutes while the dollar pairs update within seconds. So
 * this is the same figure Yahoo shows, without the batching lag.
 *
 * The quote is as old as its oldest live leg: while the currency market is
 * open the rate's time counts; while it's closed (weekends) its last rate is
 * the current one, so only the coin's time does — provided the rate is from
 * the latest session. The result must agree with Yahoo's own INR price within
 * MAX_CONVERSION_GAP, or it isn't used.
 */
export function convertedCryptoQuote(input: {
  usd: ChartSeries | null;
  fx: ChartSeries | null;
  /** Yahoo's latest INR pair price, as the cross-check. */
  inrReference: number | null;
  now: number;
}): LiveQuote | null {
  const { usd, fx, inrReference, now } = input;
  const usdPrice = usd?.regularMarketPrice ?? null;
  const usdTime = usd?.marketTime ? Date.parse(usd.marketTime) : NaN;
  const rate = fx?.regularMarketPrice ?? null;
  const rateTime = fx?.marketTime ? Date.parse(fx.marketTime) : NaN;
  if (!usdPrice || usdPrice <= 0 || !rate || rate <= 0 || !Number.isFinite(usdTime) || !Number.isFinite(rateTime)) return null;
  if (!inrReference || inrReference <= 0) return null;

  const fxClosed = fx!.sessionStart !== null && fx!.sessionEnd !== null && (now < fx!.sessionStart || now >= fx!.sessionEnd);
  if (fxClosed && rateTime < fx!.sessionStart!) return null;

  const price = usdPrice * rate;
  if (Math.abs(price / inrReference - 1) > MAX_CONVERSION_GAP) return null;
  return { price, quoteTime: fxClosed ? usdTime : Math.min(usdTime, rateTime), source: "yahoo" };
}

/**
 * Completed daily bars: today's bar is dropped while its session is still
 * running (its close isn't official yet).
 */
export function completedDailyCandles(candles: Candle[], session: SessionInfo, now: number): Candle[] {
  if (session && session.start <= now && now < session.end) {
    return candles.filter((candle) => candle.t < session.start);
  }
  return candles;
}

export function sessionOf(...histories: (History | null)[]): SessionInfo {
  for (const history of histories) {
    if (history?.sessionStart && history.sessionEnd) return { start: history.sessionStart, end: history.sessionEnd };
  }
  return null;
}

export interface MarketDataDeps {
  getHistory: typeof getHistory;
  upstoxLive: (asset: ResolvedAsset) => Promise<LiveQuote | null>;
  /** Yahoo's latest price for a symbol (chart meta); null on failure. */
  yahooLatest: (yahooSymbol: string) => Promise<ChartSeries | null>;
}

// Short enough that a quote is never served much older than Yahoo has it.
const LATEST_TTL_MS = 15_000;
const latestCache = new Map<string, { at: number; series: ChartSeries | null }>();

async function yahooLatest(yahooSymbol: string): Promise<ChartSeries | null> {
  const hit = latestCache.get(yahooSymbol);
  if (hit && Date.now() - hit.at < LATEST_TTL_MS) return hit.series;
  const series = await getYahooSeries(yahooSymbol, "1d", "1d");
  latestCache.set(yahooSymbol, { at: Date.now(), series });
  return series;
}

async function cryptoInrLive(asset: ResolvedAsset, intraday: History | null, now: number, deps: MarketDataDeps) {
  if (asset.type !== "crypto" || asset.currency !== "INR") return null;
  const [usd, fx] = await Promise.all([deps.yahooLatest(`${asset.symbol}-USD`), deps.yahooLatest("USDINR=X")]);
  return convertedCryptoQuote({ usd, fx, inrReference: intraday?.candles.at(-1)?.c ?? null, now });
}

async function upstoxLive(asset: ResolvedAsset): Promise<LiveQuote | null> {
  try {
    const index = asset.type === "index" ? INDIAN_INDICES.find((entry) => entry.symbol === asset.symbol) : null;
    const key = index ? index.instrumentKey : asset.upstoxSymbol ? (await searchUpstoxEquity(asset.upstoxSymbol))?.instrument_key : null;
    if (!key) return null;
    return parseUpstoxLiveQuote(await getUpstoxQuotes([key]), key);
  } catch {
    // Missing token or a provider failure: Yahoo is next in line.
    return null;
  }
}

export function createMarketData(
  deps: MarketDataDeps = { getHistory, upstoxLive, yahooLatest },
  config: ScoringConfig = SCORING_V2
): PredictionMarketData {
  return {
    async snapshot(assetType, symbol, now) {
      const asset = resolveAsset(assetType, symbol);
      if (!asset) return null;

      const [upstox, intraday, daily] = await Promise.all([
        assetType === "crypto" ? Promise.resolve(null) : deps.upstoxLive(asset),
        deps.getHistory(asset, "1d"),
        deps.getHistory(asset, "6mo"),
      ]);

      const converted = await cryptoInrLive(asset, intraday, now, deps);
      const session = assetType === "crypto" ? null : sessionOf(intraday, daily);
      const closes = completedDailyCandles(daily?.candles ?? [], session, now);
      const last = closes.at(-1);
      const source = daily?.source === "Upstox" ? "upstox" : "yahoo";

      return {
        symbol: asset.symbol,
        currency: intraday?.currency ?? daily?.currency ?? asset.currency,
        session,
        live: [upstox, converted, yahooLiveQuote(intraday)].filter((quote): quote is LiveQuote => quote !== null),
        // A daily bar is stamped at its session's start; the close happened at
        // that session's end, which isn't in the bar — the bar time is used.
        lastClose: last ? { price: last.c, time: last.t, source } : null,
        dailyCloses: closes.slice(-(config.submission.volatilityLookbackSessions + 1)).map((candle) => candle.c),
      };
    },
  };
}

export const marketData = createMarketData();
