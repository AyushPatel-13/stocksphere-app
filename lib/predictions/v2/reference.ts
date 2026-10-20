import { SCORING_V2, type Horizon, type ScoringConfig } from "./config";

/**
 * The reference (entry) price of a new prediction and its expiry estimate.
 * Pure: the server passes in what the providers returned and the time.
 *
 *   crypto         always live (24/7); the first fresh quote wins
 *   market open    the first fresh live quote; if none is fresh → "stale"
 *   market closed  the last official daily close ("from close")
 *
 * "Fresh" means quoted within maxQuoteAgeSeconds and not in the future. A
 * call made outside market hours is measured from the last close, and its
 * first session is the next one.
 */

export type ReferenceSource = "upstox" | "yahoo";
export type ReferenceMode = "live" | "from_close";
export type PredictionAssetKind = "stock" | "index" | "etf" | "crypto";

export type LiveQuote = { price: number; quoteTime: number; source: ReferenceSource };
export type SessionInfo = { start: number; end: number } | null;
export type LastClose = { price: number; time: number; source: ReferenceSource } | null;

export type Reference = { mode: ReferenceMode; price: number; quoteTime: number; source: ReferenceSource };
export type ReferenceError = { error: "stale" | "unavailable" };

const validPrice = (value: number) => Number.isFinite(value) && value > 0;

export function isMarketOpen(session: SessionInfo, now: number): boolean {
  return session !== null && session.start <= now && now < session.end;
}

export function chooseReference(
  input: {
    assetType: PredictionAssetKind;
    now: number;
    session: SessionInfo;
    /** In priority order. */
    live: LiveQuote[];
    lastClose: LastClose;
  },
  config: ScoringConfig = SCORING_V2
): Reference | ReferenceError {
  const { assetType, now, session, live, lastClose } = input;
  const maxAgeMs = config.submission.maxQuoteAgeSeconds * 1000;

  const fresh = live.find(
    (quote) =>
      validPrice(quote.price) &&
      Number.isFinite(quote.quoteTime) &&
      quote.quoteTime <= now &&
      now - quote.quoteTime <= maxAgeMs
  );

  if (assetType === "crypto" || isMarketOpen(session, now)) {
    if (fresh) return { mode: "live", price: fresh.price, quoteTime: fresh.quoteTime, source: fresh.source };
    // A live price exists but is old: refuse rather than guess.
    return live.some((quote) => validPrice(quote.price)) ? { error: "stale" } : { error: "unavailable" };
  }

  if (lastClose && validPrice(lastClose.price) && Number.isFinite(lastClose.time) && lastClose.time <= now) {
    return { mode: "from_close", price: lastClose.price, quoteTime: lastClose.time, source: lastClose.source };
  }
  return { error: "unavailable" };
}

/* ------------------------------------------------------------ expiry */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Typical regular-session close, UTC: NSE 15:30 IST, NYSE 16:00 ET (EST). */
export function defaultCloseTimeOfDayMs(currency: string | null): number {
  return currency === "INR" ? 10 * HOUR_MS : 21 * HOUR_MS;
}

const isWeekday = (time: number) => {
  const day = new Date(time).getUTCDay();
  return day !== 0 && day !== 6;
};

export type ExpiryEstimate = {
  /** Trading sessions to expiry (exchange-traded assets); null for crypto. */
  expirySessions: 1 | 5 | 21 | null;
  /** Exact expiry (crypto); null for exchange-traded assets. */
  expiresAt: number | null;
  /** For display and "due" scanning only. */
  estimatedExpiryAt: number;
};

/**
 * Session 1 is the first weekday close after `now` (today's close during the
 * session; the next one after hours or at the weekend); the Nth session is
 * N−1 weekdays later. Holidays are not known here — this is an estimate, and
 * the resolver finds the real Nth session from market data.
 */
export function estimateExpiry(
  input: {
    now: number;
    horizon: Horizon;
    assetType: PredictionAssetKind;
    /** Close time of day in UTC ms, e.g. from the provider's session end. */
    closeTimeOfDayMs: number;
  },
  config: ScoringConfig = SCORING_V2
): ExpiryEstimate {
  const rules = config.horizons[input.horizon];

  if (input.assetType === "crypto") {
    const at = input.now + rules.cryptoHours * HOUR_MS;
    return { expirySessions: null, expiresAt: at, estimatedExpiryAt: at };
  }

  const startOfDay = Math.floor(input.now / DAY_MS) * DAY_MS;
  let close = startOfDay + input.closeTimeOfDayMs;
  while (close <= input.now || !isWeekday(close)) close += DAY_MS;

  for (let counted = 1; counted < rules.sessions; ) {
    close += DAY_MS;
    if (isWeekday(close)) counted++;
  }

  return { expirySessions: rules.sessions as 1 | 5 | 21, expiresAt: null, estimatedExpiryAt: close };
}

/** Time of day (UTC ms) of a session end, for estimateExpiry. */
export function timeOfDayMs(time: number): number {
  return ((time % DAY_MS) + DAY_MS) % DAY_MS;
}
