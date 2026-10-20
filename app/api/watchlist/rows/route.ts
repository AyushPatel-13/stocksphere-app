import { NextResponse } from "next/server";

import { MAX_WATCHLIST_SYMBOLS, getWatchlistRows, parseSymbolList } from "@/lib/services/watchlistRows";

/**
 * GET /api/watchlist/rows?symbols=TCS,INFY,AAPL
 *
 * Price, day change, volume, 52-week range and sparkline for up to
 * MAX_WATCHLIST_SYMBOLS symbols in one request. Public market data only —
 * which symbols a member watches stays in their own Supabase rows.
 */
export async function GET(
  request: Request,
  _context?: unknown,
  load: typeof getWatchlistRows = getWatchlistRows
) {
  const symbols = parseSymbolList(new URL(request.url).searchParams.get("symbols"));
  if (!symbols) {
    return NextResponse.json(
      { success: false, error: `Pass 1–${MAX_WATCHLIST_SYMBOLS} valid symbols, comma-separated.` },
      { status: 400 }
    );
  }

  try {
    const rows = await load(symbols);
    return NextResponse.json(
      { success: true, rows },
      { headers: { "Cache-Control": "private, max-age=30" } }
    );
  } catch (error) {
    console.error("Watchlist rows error:", error);
    return NextResponse.json({ success: false, error: "Couldn't load prices." }, { status: 500 });
  }
}
