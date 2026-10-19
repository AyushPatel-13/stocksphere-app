import { NextResponse } from "next/server";

import { getNifty50Quotes } from "@/lib/providers/market.provider";

/**
 * Every Nifty 50 quote, for the Explore page's movers table.
 *
 * /api/market/movers stays as it is: its ten-field shape is the Home page's
 * contract, and it returns only the top three each way. Explore needs the whole
 * universe so it can rank gainers, losers and the most active stocks itself.
 *
 * One Nifty 50 load is 50 Upstox instrument lookups plus a bulk quote, so the
 * answer is reused for 30 seconds and concurrent requests share one load. An
 * empty answer (Upstox unavailable) is never cached.
 *
 * Failure contract, matching /api/market/movers: unavailable → 503, unexpected
 * throw → 500, both exactly { success: false, error }.
 */
// Route files may only export Next.js route fields, so the cache stays private.
const NIFTY50_CACHE_TTL_MS = 30_000;

type Quotes = Awaited<ReturnType<typeof getNifty50Quotes>>;

let cached: { quotes: Quotes; at: number } | null = null;
let inFlight: Promise<Quotes> | null = null;

async function loadCached(loadQuotes: typeof getNifty50Quotes, now: number) {
  if (cached && now - cached.at < NIFTY50_CACHE_TTL_MS) {
    return cached.quotes;
  }

  if (!inFlight) {
    inFlight = loadQuotes()
      .then((quotes) => {
        if (quotes.length > 0) cached = { quotes, at: Date.now() };
        return quotes;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return inFlight;
}

export async function GET(
  _request?: Request,
  _context?: unknown,
  loadQuotes: typeof getNifty50Quotes = getNifty50Quotes
) {
  try {
    const quotes = await loadCached(loadQuotes, Date.now());

    if (quotes.length === 0) {
      return NextResponse.json(
        { success: false, error: "Nifty 50 market data is unavailable" },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        universe: "NIFTY_50",
        quotes: quotes.map((quote) => ({
          symbol: quote.symbol,
          price: quote.price,
          change: quote.change ?? null,
          changePercent: quote.changePercent ?? null,
          volume: quote.volume ?? null,
          currency: quote.currency ?? "INR",
        })),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30",
        },
      }
    );
  } catch (error) {
    console.error("Nifty 50 quotes error:", error);

    return NextResponse.json(
      { success: false, error: "Failed to load Nifty 50 quotes" },
      { status: 500 }
    );
  }
}
