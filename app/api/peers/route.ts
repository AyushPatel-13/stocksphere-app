import { NextResponse } from "next/server";

import { getPeersCached, type Peers } from "@/lib/services/peers";
import { isValidSymbol } from "@/lib/validation/symbol";

/**
 * GET /api/peers?symbol=HDFCBANK
 *
 * Same-sector companies for an Indian stock in the NIFTY 500, with price,
 * market cap, P/E, revenue and net margin (lib/services/peers.ts). 400 for a
 * symbol that isn't one; 404 with a reason when there are no peers to show
 * (a US stock, a stock outside the NIFTY 500, or the lists are unreachable).
 */
export async function GET(request: Request, _context?: unknown, load: (symbol: string) => Promise<Peers | null> = (s) => getPeersCached(s)) {
  const symbol = (new URL(request.url).searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol || !isValidSymbol(symbol)) {
    return NextResponse.json({ success: false, error: "Pass a valid stock symbol." }, { status: 400 });
  }
  const peers = await load(symbol).catch(() => null);
  if (!peers) {
    return NextResponse.json({ success: false, error: "Peer comparison covers NIFTY 500 companies for now.", code: "NOT_COVERED" }, { status: 404 });
  }
  return NextResponse.json({ success: true, ...peers }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
}
