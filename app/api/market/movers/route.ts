import { NextResponse } from "next/server";

import { getNifty50Quotes } from "@/lib/providers/market.provider";
import { loadMarketMovers } from "@/lib/services/marketMovers";

export const revalidate = 60;

/**
 * Nifty 50 breadth and the top three movers each way.
 *
 * The ranking itself lives in lib/services/marketMovers.ts, because the Agent's
 * market-movers tool needs the same answer and a route file may only export the
 * names Next.js allows, so it could not be shared from here.
 *
 * Failure contract, matching /api/market: an unavailable provider is a 503 and
 * an unexpected exception is a 500, and both answer exactly
 * { success: false, error }. Neither is ever a 200, because the Home page
 * treats success:true as "the market is genuinely this quiet" and renders
 * "No advancing Nifty 50 stocks right now" — a false statement during an
 * outage.
 *
 * A *partial* answer still succeeds: 40 quotes out of 50 is degraded data, not
 * a failed request, and reclassifying it would change what the movers are
 * computed from.
 *
 * `loadQuotes` is injectable for the same reason getMarketQuote() takes its
 * provider lookups as parameters (lib/providers/market.provider.ts): the
 * chain below catches its own errors and reports them as an empty array, so a
 * test cannot reach every branch by stubbing fetch alone. Next.js calls a
 * route handler with (request, context), so the injected provider has to be
 * the third parameter.
 */
export async function GET(
  _request?: Request,
  _context?: unknown,
  loadQuotes: typeof getNifty50Quotes = getNifty50Quotes
) {
  try {
    const summary = await loadMarketMovers(loadQuotes);

    // null is the provider failure described above: an empty answer for a
    // non-empty universe. It stays a 503 rather than becoming an empty ranking.
    if (!summary) {
      console.error("Nifty 50 market movers: provider returned no quotes");

      return NextResponse.json(
        {
          success: false,
          error: "Nifty 50 market data is unavailable",
        },
        { status: 503 }
      );
    }

    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    console.error("Nifty 50 market movers error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to load Nifty 50 market movers",
      },
      { status: 500 }
    );
  }
}
