import { NextResponse } from "next/server";

import { getFoBanList, type FoBanList } from "@/lib/apis/nseFoBan";

/**
 * GET /api/fo-ban
 *
 * NSE's securities in the F&O ban period, from its daily fo_secban.csv, with
 * the trade date the file is for. The list is cached by lib/apis/nseFoBan.ts;
 * 503 when NSE can't be reached (never an empty list, which would read as
 * "nothing is banned").
 */
export async function GET(_request?: Request, _context?: unknown, load: () => Promise<FoBanList | null> = () => getFoBanList()) {
  const list = await load().catch(() => null);
  if (!list) {
    return NextResponse.json({ success: false, error: "NSE's F&O ban list is unavailable right now." }, { status: 503 });
  }
  return NextResponse.json(
    { success: true, tradeDate: list.tradeDate, securities: list.securities, source: "NSE fo_secban.csv", sourceUrl: list.sourceUrl },
    { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=600" } }
  );
}
