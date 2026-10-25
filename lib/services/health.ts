import { checkUpstoxToken, type UpstoxResult } from "@/lib/apis/upstox";

/**
 * Status of the dependencies a tester would notice first. Says only whether
 * each one works — never a key, a token or an upstream error body.
 */

export type UpstoxHealth = "ok" | "expired" | "not_configured" | "unreachable";

export type Health = {
  upstox: { status: UpstoxHealth; message: string };
  checkedAt: string;
};

const MESSAGES: Record<UpstoxHealth, string> = {
  ok: "Upstox accepts the access token.",
  expired: "Upstox rejected the access token — it has probably expired (standard Upstox tokens expire daily). Indian prices, IPOs and commodities are unavailable until UPSTOX_ACCESS_TOKEN is renewed.",
  not_configured: "UPSTOX_ACCESS_TOKEN is not set on this server.",
  unreachable: "Upstox didn't answer, so the token couldn't be checked.",
};

export function upstoxHealthOf(result: UpstoxResult): UpstoxHealth {
  if (result.ok) return "ok";
  if (result.code === "auth") return "expired";
  if (result.code === "not_configured") return "not_configured";
  return "unreachable";
}

// One upstream check per instance per CACHE_MS, however often this is polled.
const CACHE_MS = 5 * 60_000;
let cached: { at: number; value: Health } | null = null;

export async function getHealth(check: typeof checkUpstoxToken = checkUpstoxToken, now: number = Date.now()): Promise<Health> {
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const status = upstoxHealthOf(await check());
  const value: Health = { upstox: { status, message: MESSAGES[status] }, checkedAt: new Date(now).toISOString() };
  cached = { at: now, value };
  return value;
}

/** Test hook. */
export function clearHealthCache() {
  cached = null;
}
