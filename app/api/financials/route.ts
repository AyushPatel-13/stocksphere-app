import { NextResponse } from "next/server";

import { getYahooStatements, type Statements } from "@/lib/apis/yahooStatements";
import { resolveAsset } from "@/lib/services/history";

/**
 * GET /api/financials?symbol=TCS
 *
 * A stock's income statement, balance sheet and cash flow as reported: the
 * last four fiscal years and five quarters, with the reporting currency
 * (lib/apis/yahooStatements.ts). 400 for a symbol that isn't one; 404 when
 * the source has no statements for it (an ETF, a new listing) or can't be
 * reached, never an empty table that would read as "nothing to report".
 */
export async function GET(request: Request, _context?: unknown, load: (yahooSymbol: string) => Promise<Statements | null> = (s) => getYahooStatements(s)) {
  const symbol = new URL(request.url).searchParams.get("symbol") ?? "";
  const asset = symbol ? resolveAsset("stock", symbol) : null;
  if (!asset) {
    return NextResponse.json({ success: false, error: "Pass a valid stock symbol." }, { status: 400 });
  }

  const statements = await load(asset.yahoo).catch(() => null);
  if (!statements) {
    return NextResponse.json({ success: false, error: "Financial statements aren't available for this stock right now." }, { status: 404 });
  }
  return NextResponse.json(
    { success: true, symbol: asset.symbol, source: "Yahoo Finance", ...statements },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600" } }
  );
}
