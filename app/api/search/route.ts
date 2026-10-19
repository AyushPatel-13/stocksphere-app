import { NextResponse } from "next/server";

import { normaliseQuery, searchInstruments } from "@/lib/search/instruments";

/**
 * GET /api/search?q=reliance&limit=8
 *
 * Instrument autocomplete across Indian and US stocks, ETFs, indices, crypto
 * and bonds (see lib/search/instruments.ts). Provider keys stay on the server.
 *
 *   200 { success, query, results, partial }
 *   400 invalid query · 429 too many searches
 *
 * This route used to answer from a hardcoded list of five stocks and was not
 * called by any page.
 */

// Per-client limiter. In memory, per server instance — enough to stop a
// runaway client from spending the providers' quotas; a shared store is the
// production upgrade (same note as /api/agent).
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
  // Bounded: forget the oldest client rather than grow without limit.
  if (!hits.has(clientId) && hits.size >= MAX_TRACKED_CLIENTS) hits.delete(hits.keys().next().value as string);
  hits.set(clientId, recent);
  return false;
}

export async function GET(
  request: Request,
  _context?: unknown,
  search: typeof searchInstruments = searchInstruments
) {
  const clientId = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(clientId, Date.now())) {
    return NextResponse.json(
      { success: false, error: "Too many searches. Please slow down." },
      { status: 429, headers: { "Retry-After": "30" } }
    );
  }

  const params = new URL(request.url).searchParams;
  const query = normaliseQuery(params.get("q"));

  if (!query) {
    return NextResponse.json(
      { success: false, error: "Use 1–40 letters, numbers, spaces or & . - '" },
      { status: 400 }
    );
  }

  try {
    const result = await search(query, Number(params.get("limit")) || undefined);
    return NextResponse.json(
      { success: true, ...result },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ success: false, error: "Search is unavailable right now." }, { status: 500 });
  }
}
