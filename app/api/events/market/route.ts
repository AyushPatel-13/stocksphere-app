import { NextResponse } from "next/server";

import { getMarketEventStore, ingestIfDue, type MarketEventStore } from "@/lib/markets/eventIngest";
import { isValidSymbol } from "@/lib/validation/symbol";
import { isMissingTable } from "@/lib/watchlistRules";

/**
 * GET /api/events/market?symbol=TCS&days=30
 *   NSE corporate actions (ex-dates) and board meetings (results dates) from
 *   today, read from NSE's public feeds. symbol is an NSE symbol; days 1–90.
 *   Events NSE named a company for that isn't in its main-board list are
 *   included with mapped: false and no symbol (calendar view only).
 */
export async function GET(
  request: Request,
  _context?: unknown,
  store: MarketEventStore | null = getMarketEventStore(),
  now: () => number = Date.now,
  refresh: (store: MarketEventStore) => Promise<void> = (s) => ingestIfDue(s)
) {
  if (!store) {
    return NextResponse.json({ success: false, error: "Market events aren't set up yet.", code: "NOT_CONFIGURED" }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol")?.trim().toUpperCase().replace(/\.(NS|BSE?)$/, "") || undefined;
  if (symbol && !isValidSymbol(symbol)) {
    return NextResponse.json({ success: false, error: "Invalid symbol" }, { status: 400 });
  }
  const daysParam = Number(params.get("days") ?? 30);
  if (!Number.isInteger(daysParam) || daysParam < 1 || daysParam > 90) {
    return NextResponse.json({ success: false, error: "days must be a whole number from 1 to 90." }, { status: 400 });
  }

  // Dates are NSE's (IST): "today" is today in India.
  const istDay = (t: number) => new Date(t + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const from = istDay(now());
  const to = istDay(now() + daysParam * 86_400_000);

  try {
    await refresh(store);
    const events = await store.list({ symbol, from, to, limit: symbol ? 50 : 300 });
    return NextResponse.json(
      { success: true, from, to, source: "NSE", events },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
    );
  } catch (error) {
    if (isMissingTable(error as { code?: string; message?: string })) {
      return NextResponse.json({ success: false, error: "Market events are launching soon.", code: "NOT_CONFIGURED" }, { status: 503 });
    }
    console.error("Market events error:", error);
    return NextResponse.json({ success: false, error: "Couldn't load market events." }, { status: 503 });
  }
}
