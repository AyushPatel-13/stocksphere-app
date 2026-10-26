import { NextResponse } from "next/server";

import { ENTITY_QUERY_MAX, defaultEntityDeps, searchEntities, type EntityDeps } from "@/lib/community/entities";

/**
 * GET /api/community/entities?q=sbi
 *
 * The composer's @ autocomplete: listed instruments whose pages have a
 * discussion (stocks, ETFs, indices, crypto — from the shared instrument
 * search) and open or upcoming IPOs (Upstox IPO catalogue). Read-only and
 * public, like /api/search. A pick is verified again when the post is saved.
 *
 *   200 { success, query, results, partial } · 400 bad query · 429 too many
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const MAX_TRACKED_CLIENTS = 5_000;
const hits = new Map<string, number[]>();

function rateLimited(clientId: string, now: number): boolean {
  const recent = (hits.get(clientId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(clientId, recent);
    return true;
  }
  recent.push(now);
  if (!hits.has(clientId) && hits.size >= MAX_TRACKED_CLIENTS) hits.delete(hits.keys().next().value as string);
  hits.set(clientId, recent);
  return false;
}

/** Letters, digits, spaces and the punctuation names and tickers use. */
const QUERY = /^[A-Za-z0-9][A-Za-z0-9 &.'-]*$/;

export async function GET(request: Request, _context?: unknown, deps: EntityDeps = defaultEntityDeps) {
  const clientId = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(clientId, Date.now())) {
    return NextResponse.json({ success: false, error: "Too many searches. Please slow down." }, { status: 429, headers: { "Retry-After": "30" } });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q || q.length > ENTITY_QUERY_MAX || !QUERY.test(q)) {
    return NextResponse.json({ success: false, error: `Type 1–${ENTITY_QUERY_MAX} letters or numbers.` }, { status: 400 });
  }

  try {
    const result = await searchEntities(q, deps);
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    console.error("Entity search error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ success: false, error: "Search is unavailable right now." }, { status: 500 });
  }
}
