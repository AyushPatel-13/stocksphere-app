/**
 * One gate in front of every Upstox request, so a rate limit is respected by
 * the whole server instead of being hit again by each caller.
 *
 * When Upstox answers 429 ("Too Many Request Sent", UDAPI10005 — seen on
 * instrument search on 25 Oct 2026 when several pages loaded at once), every
 * Upstox call for the next UPSTOX_COOLDOWN_MS is answered here with a local
 * 429 instead of going out. Callers already treat a 429 like any other Upstox
 * failure, so they move straight to their Yahoo fallback without waiting on a
 * request that would be refused anyway. Per server instance, like the other
 * in-memory limits.
 */

export const UPSTOX_COOLDOWN_MS = 60_000;

let coolUntil = 0;

export function upstoxCoolingDown(now: number = Date.now()): boolean {
  return now < coolUntil;
}

/** Record what Upstox answered; a 429 starts (or extends) the cooldown. */
export function noteUpstoxStatus(status: number, now: number = Date.now()): void {
  if (status === 429) coolUntil = Math.max(coolUntil, now + UPSTOX_COOLDOWN_MS);
}

/** Test hook. */
export function resetUpstoxCooldown(): void {
  coolUntil = 0;
}

const COOLING_BODY = JSON.stringify({
  status: "error",
  errors: [{ errorCode: "STOCKSPHERE_COOLDOWN", message: "Upstox rate-limited this server recently; not sent." }],
});

/** fetch() for api.upstox.com, behind the cooldown. */
export async function upstoxFetch(input: string, init?: RequestInit): Promise<Response> {
  if (upstoxCoolingDown()) {
    return new Response(COOLING_BODY, { status: 429, headers: { "Content-Type": "application/json" } });
  }
  const response = await fetch(input, init);
  noteUpstoxStatus(response.status);
  return response;
}
