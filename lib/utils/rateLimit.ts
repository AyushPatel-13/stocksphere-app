/**
 * A sliding-window counter, kept in this server instance's memory.
 *
 * Used for two things that must not depend on a database round trip:
 *   - provider budgets (Twelve Data 8 credits/min, Alpha Vantage 25/day), so
 *     one busy page or one abusive caller can't spend the free tier for
 *     everyone — a call over budget is skipped and the chain moves on;
 *   - per-client limits on public routes that spend those budgets.
 *
 * Per instance, so several serverless instances each get the full allowance.
 * That still bounds spend to a small multiple, which is the point; anything
 * that must be exact across instances (the AI limit) lives in Postgres.
 */

export type WindowLimiter = {
  /** Records a hit for `key` and says whether it was within the limit. */
  take(key?: string, now?: number): boolean;
  /** Milliseconds until `key` has room again (0 when it has room now). */
  retryAfterMs(key?: string, now?: number): number;
};

export function createWindowLimiter(options: { limit: number; windowMs: number; maxKeys?: number }): WindowLimiter {
  const { limit, windowMs, maxKeys = 5_000 } = options;
  const hits = new Map<string, number[]>();

  const recent = (key: string, now: number) => {
    const kept = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
    if (kept.length) hits.set(key, kept);
    else hits.delete(key);
    return kept;
  };

  return {
    take(key = "", now = Date.now()) {
      const kept = recent(key, now);
      if (kept.length >= limit) return false;
      // Oldest key goes first when the map is full, so memory stays bounded.
      if (!hits.has(key) && hits.size >= maxKeys) hits.delete(hits.keys().next().value as string);
      hits.set(key, [...kept, now]);
      return true;
    },
    retryAfterMs(key = "", now = Date.now()) {
      const kept = recent(key, now);
      return kept.length < limit ? 0 : Math.max(0, windowMs - (now - kept[0]));
    },
  };
}

/**
 * The caller's address as the hosting edge reports it (first hop of
 * x-forwarded-for, which Vercel sets and a client cannot remove). Null when
 * there is none — local tests and scripts — so callers skip the limit.
 */
export function clientAddress(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || null;
}
