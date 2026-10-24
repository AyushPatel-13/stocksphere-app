import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdminClient, getPublicClient } from "@/lib/supabase/server";

/**
 * Who may use StockSphere AI, and how often.
 *
 * Only signed-in members: every answer spends provider quota, so anonymous
 * traffic would let one script use up the whole beta's allowance.
 *
 * The limit is counted in Postgres (public.ai_take_slot, migration
 * 20261024000100_ai_usage.sql) so it holds across Vercel's serverless
 * instances and redeploys. Until that migration is applied — or when the
 * service-role key is missing — it falls back to a per-user in-memory count,
 * which is the old behaviour (per instance, reset on deploy) but keyed by
 * account instead of IP.
 */

export const AI_LIMIT_PER_MINUTE = 5;
export const AI_LIMIT_PER_DAY = 40;

export type SlotResult =
  | { ok: true; shared: boolean }
  | { ok: false; window: "minute" | "day"; retryAfterSeconds: number; shared: boolean };

export type AgentAccess = {
  /** The user id behind a Supabase access token, or null if it isn't valid. */
  verifyToken(token: string): Promise<string | null>;
  takeSlot(userId: string): Promise<SlotResult>;
};

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

// --- in-memory fallback ------------------------------------------------

const memory = new Map<string, number[]>();

export function takeMemorySlot(userId: string, now: number, store = memory): SlotResult {
  const day = (store.get(userId) ?? []).filter((t) => now - t < 86_400_000);
  const minute = day.filter((t) => now - t < 60_000);

  if (day.length >= AI_LIMIT_PER_DAY) {
    store.set(userId, day);
    return { ok: false, window: "day", retryAfterSeconds: Math.ceil((day[0] + 86_400_000 - now) / 1000), shared: false };
  }
  if (minute.length >= AI_LIMIT_PER_MINUTE) {
    store.set(userId, day);
    return { ok: false, window: "minute", retryAfterSeconds: Math.ceil((minute[0] + 60_000 - now) / 1000), shared: false };
  }

  day.push(now);
  store.set(userId, day);
  return { ok: true, shared: false };
}

// --- shared (Postgres) limiter -------------------------------------------

type SlotRow = { allowed: boolean; reason: string | null; retry_after_seconds: number | null };

/** PostgREST / Postgres codes meaning "the function isn't there yet". */
function isMissingFunction(error: { code?: string; message?: string }) {
  const message = error.message ?? "";
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    (/ai_take_slot/.test(message) && /not find|does not exist/i.test(message))
  );
}

let warnedFallback = false;

export async function takeSharedSlot(
  userId: string,
  admin: SupabaseClient | null,
  now: () => number = Date.now
): Promise<SlotResult> {
  const fallback = (why: string) => {
    if (!warnedFallback) {
      console.warn(`StockSphere AI rate limit: using the in-memory fallback (${why}).`);
      warnedFallback = true;
    }
    return takeMemorySlot(userId, now());
  };

  if (!admin) return fallback("no service-role key");

  const { data, error } = await admin.rpc("ai_take_slot", {
    p_user: userId,
    p_per_minute: AI_LIMIT_PER_MINUTE,
    p_per_day: AI_LIMIT_PER_DAY,
  });

  if (error) {
    if (isMissingFunction(error)) return fallback("ai_usage migration not applied");
    // A database hiccup shouldn't lock everyone out, but it shouldn't remove
    // the limit either: count in memory for this request.
    console.error("ai_take_slot failed:", error.code);
    return fallback("database error");
  }

  const row = (Array.isArray(data) ? data[0] : data) as SlotRow | undefined;
  if (!row) return fallback("empty response");
  if (row.allowed) return { ok: true, shared: true };
  return {
    ok: false,
    window: row.reason === "day" ? "day" : "minute",
    retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds) || 60),
    shared: true,
  };
}

export const defaultAgentAccess: AgentAccess = {
  async verifyToken(token) {
    const client = getPublicClient();
    if (!client) return null;
    const { data, error } = await client.auth.getUser(token);
    return error || !data.user ? null : data.user.id;
  },
  takeSlot: (userId) => takeSharedSlot(userId, getAdminClient()),
};
