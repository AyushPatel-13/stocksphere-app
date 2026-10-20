import type { Candle } from "../../apis/yahooChart";
import type { ReferenceMode } from "./reference";

/**
 * Finding a prediction's exit price. Pure: the resolver passes in daily (or,
 * for crypto, intraday) bars and the time.
 *
 * Exchange-traded assets: the exit is the official close of the Nth trading
 * session, counted from real daily bars (so holidays are skipped naturally):
 *   live call        session 1 is the day of submission
 *   from_close call  session 1 is the first session after the reference close
 * The exit is used only once that session has finished (+30 minutes for the
 * close to settle). Crypto: the close of the first bar at or after expiry.
 *
 * If no exit can be found within the grace period the prediction is void.
 */

export const SETTLE_MS = 30 * 60_000;
export const GRACE_MS = 7 * 86_400_000;

export function exchangeTimeZone(currency: string | null): string {
  return currency === "INR" ? "Asia/Kolkata" : "America/New_York";
}

/** YYYY-MM-DD of an instant in a time zone. */
export function sessionDate(time: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time));
}

export type ExitDecision =
  | { kind: "wait" }
  | { kind: "exit"; price: number; session: string | null; barTime: number }
  | { kind: "void"; reason: string };

export function findSessionExit(input: {
  daily: Candle[];
  referenceMode: ReferenceMode;
  referenceQuoteTime: number;
  expirySessions: number;
  timeZone: string;
  /** Today's regular session, when the provider says (to tell a finished bar from a running one). */
  todaySession: { start: number; end: number } | null;
  estimatedExpiryAt: number;
  now: number;
}): ExitDecision {
  const { daily, referenceMode, referenceQuoteTime, expirySessions, timeZone, todaySession, estimatedExpiryAt, now } = input;

  const referenceDay = sessionDate(referenceQuoteTime, timeZone);
  const sessions = daily
    .filter((bar) => bar.c > 0)
    .map((bar) => ({ bar, day: sessionDate(bar.t, timeZone) }))
    .filter(({ day }) => (referenceMode === "live" ? day >= referenceDay : day > referenceDay))
    .sort((a, b) => a.bar.t - b.bar.t);

  // One bar per day (some feeds repeat today's bar).
  const unique = sessions.filter((s, i) => i === 0 || s.day !== sessions[i - 1].day);
  const exit = unique[expirySessions - 1];

  if (!exit) {
    return now > estimatedExpiryAt + GRACE_MS ? { kind: "void", reason: "no-exit-data" } : { kind: "wait" };
  }

  // The Nth session must be over: never score from a bar that's still trading.
  const today = sessionDate(now, timeZone);
  if (exit.day === today) {
    if (!todaySession || now < todaySession.end + SETTLE_MS) return { kind: "wait" };
  }
  if (exit.day > today) return { kind: "wait" };

  return { kind: "exit", price: exit.bar.c, session: exit.day, barTime: exit.bar.t };
}

export function findCryptoExit(input: { bars: Candle[]; expiresAt: number; now: number }): ExitDecision {
  const { bars, expiresAt, now } = input;
  if (now < expiresAt + 5 * 60_000) return { kind: "wait" };

  const bar = [...bars].sort((a, b) => a.t - b.t).find((candle) => candle.t >= expiresAt && candle.c > 0);
  if (bar) return { kind: "exit", price: bar.c, session: null, barTime: bar.t };
  return now > expiresAt + GRACE_MS ? { kind: "void", reason: "no-exit-data" } : { kind: "wait" };
}
