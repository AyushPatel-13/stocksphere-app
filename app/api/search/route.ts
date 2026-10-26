import { NextResponse } from "next/server";

import { searchInstruments } from "@/lib/search/instruments";
import { parseFilters, parseQuery } from "@/lib/search/types";

/**
 * GET /api/search?q=reliance&limit=8[&types=stock,etf][&market=India][&exchange=NSE]
 *
 * Instrument autocomplete across Indian and US stocks, ETFs, indices, crypto,
 * bonds and MCX commodities (see lib/search/instruments.ts). Every instrument
 * field in the app asks this route. Provider keys stay on the server.
 *
 * An exchange typed into the query ("NSE:SBIN", "SBIN.NS") becomes the
 * exchange filter unless the caller set one.
 *
 *   200 { success, query, results, partial }
 *   400 invalid query or filter · 429 too many searches
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
  const parsed = parseQuery(params.get("q"));

  if (!parsed) {
    return NextResponse.json(
      { success: false, error: "Type 1–40 letters or numbers to search." },
      { status: 400 }
    );
  }

  const filters = parseFilters(params, parsed.filters);
  if (!filters) {
    return NextResponse.json({ success: false, error: "Unknown search filter." }, { status: 400 });
  }

  try {
    const result = await search(parsed.text, Number(params.get("limit")) || undefined, filters);
    return NextResponse.json(
      { success: true, ...result },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ success: false, error: "Search is unavailable right now." }, { status: 500 });
  }
}
