import { NextResponse } from "next/server";

import type { AssetType } from "@/lib/data/assets";
import { COMMODITY_ERROR_MESSAGES, getCommodityHistory } from "@/lib/services/commodities";
import { getHistory, isHistoryRange, resolveAsset, type HistoryRange } from "@/lib/services/history";

async function commodityHistory(
  symbol: string,
  expiry: string | null,
  range: HistoryRange,
  load: typeof getCommodityHistory
) {
  try {
    const result = await load(symbol, expiry && /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? expiry : null, range);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, code: result.code, error: COMMODITY_ERROR_MESSAGES[result.code] },
        { status: result.code === "not_found" ? 404 : 503 }
      );
    }
    if (!result.value) {
      return NextResponse.json(
        { success: false, error: "This contract has no trades in this range yet." },
        { status: 404 }
      );
    }
    const maxAge = range === "1d" || range === "5d" ? 60 : 600;
    return NextResponse.json(
      { success: true, ...result.value },
      { headers: { "Cache-Control": `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}` } }
    );
  } catch (error) {
    console.error("Commodity history error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ success: false, error: "Couldn't load price history." }, { status: 500 });
  }
}

/**
 * GET /api/history?type=stock|index|etf|crypto|bond&symbol=TCS&range=1d|5d|1mo|6mo|1y|5y|max&vs=inr|usd
 * GET /api/history?type=commodity&symbol=CRUDEOIL&expiry=2026-11-19&range=1d
 *
 *   200  { success, ...History }
 *   400  unknown type / range / symbol
 *   404  no history available for that asset and range
 */
const TYPES: AssetType[] = ["stock", "index", "etf", "crypto", "bond"];

export async function GET(
  request: Request,
  _context?: unknown,
  load: typeof getHistory = getHistory,
  loadCommodity: typeof getCommodityHistory = getCommodityHistory
) {
  const params = new URL(request.url).searchParams;
  const type = (params.get("type") ?? "stock") as AssetType;
  const range = params.get("range") ?? "1y";
  const vs = params.get("vs")?.toUpperCase() === "USD" ? "USD" : "INR";

  // MCX futures come from Upstox, one contract at a time (?expiry=YYYY-MM-DD,
  // nearest open contract when omitted). See lib/services/commodities.ts.
  if ((type as string) === "commodity" && isHistoryRange(range)) {
    return commodityHistory(params.get("symbol") ?? "", params.get("expiry"), range, loadCommodity);
  }

  if (!TYPES.includes(type) || !isHistoryRange(range)) {
    return NextResponse.json({ success: false, error: "Invalid type or range" }, { status: 400 });
  }

  const asset = resolveAsset(type, params.get("symbol") ?? "", vs);
  if (!asset) {
    return NextResponse.json({ success: false, error: "Unknown asset" }, { status: 400 });
  }

  try {
    const history = await load(asset, range);

    if (!history) {
      return NextResponse.json(
        { success: false, error: "No price history is available for this range." },
        { status: 404 }
      );
    }

    const maxAge = range === "1d" || range === "5d" ? 60 : 600;
    return NextResponse.json(
      { success: true, ...history },
      { headers: { "Cache-Control": `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}` } }
    );
  } catch (error) {
    console.error("History error:", error);
    return NextResponse.json({ success: false, error: "Couldn't load price history." }, { status: 500 });
  }
}
