import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase clients. Import these ONLY from route handlers and
 * server modules — never from a "use client" file.
 *
 *   getPublicClient()  anon key, no session: reads go through RLS exactly as
 *                      for a signed-out visitor (hidden posts stay hidden).
 *   getAdminClient()   service-role key: bypasses RLS. Used only for the
 *                      writes the server has already validated (new posts)
 *                      and for checks the server must make (rate counts).
 *                      Null when SUPABASE_SERVICE_ROLE_KEY is not configured,
 *                      so callers can answer "not set up" instead of crashing.
 *
 * SUPABASE_SERVICE_ROLE_KEY must never be given a NEXT_PUBLIC_ prefix.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const noSession = { auth: { persistSession: false, autoRefreshToken: false } } as const;

let publicClient: SupabaseClient | null = null;
let adminClient: SupabaseClient | null = null;

export function getPublicClient(): SupabaseClient | null {
  if (!url || !anonKey) return null;
  publicClient ??= createClient(url, anonKey, noSession);
  return publicClient;
}

/**
 * A client acting as one signed-in member: their access token rides on every
 * request, so row-level security limits it to that member's rows exactly as
 * in their browser. A new client per call — never cached, never shared.
 */
export function getUserClient(accessToken: string): SupabaseClient | null {
  if (!url || !anonKey || !accessToken) return null;
  return createClient(url, anonKey, { ...noSession, global: { headers: { Authorization: `Bearer ${accessToken}` } } });
}

export function getAdminClient(): SupabaseClient | null {
  if (!url || !serviceKey) return null;
  adminClient ??= createClient(url, serviceKey, noSession);
  return adminClient;
}
