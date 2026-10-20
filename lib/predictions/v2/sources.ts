import { getUpstoxQuotes, searchUpstoxEquity } from "../../apis/upstox";
import type { Candle } from "../../apis/yahooChart";
import { INDIAN_INDICES } from "../../data/instruments/indices";
import { getHistory, resolveAsset, type History, type ResolvedAsset } from "../../services/history";
import { SCORING_V2, type ScoringConfig } from "./config";
import type { LastClose, LiveQuote, PredictionAssetKind, SessionInfo } from "./reference";

/**
 * What the server knows about an asset at the moment of a prediction, read
 * from the providers StockSphere already uses:
 *
 *   live quote   Upstox last traded price (Indian stocks, ETFs, indices),
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
  deps: MarketDataDeps = { getHistory, upstoxLive },
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

      const session = assetType === "crypto" ? null : sessionOf(intraday, daily);
      const closes = completedDailyCandles(daily?.candles ?? [], session, now);
      const last = closes.at(-1);
      const source = daily?.source === "Upstox" ? "upstox" : "yahoo";

      return {
        symbol: asset.symbol,
        currency: intraday?.currency ?? daily?.currency ?? asset.currency,
        session,
        live: [upstox, yahooLiveQuote(intraday)].filter((quote): quote is LiveQuote => quote !== null),
        // A daily bar is stamped at its session's start; the close happened at
        // that session's end, which isn't in the bar — the bar time is used.
        lastClose: last ? { price: last.c, time: last.t, source } : null,
        dailyCloses: closes.slice(-(config.submission.volatilityLookbackSessions + 1)).map((candle) => candle.c),
      };
    },
  };
}

export const marketData = createMarketData();
