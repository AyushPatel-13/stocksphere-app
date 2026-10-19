import { NextResponse } from "next/server";

import {
  getPredictionStore,
  historyPrices,
  resolveDue,
  type PredictionStore,
  type PriceSource,
} from "@/lib/predictions/service";

/**
 * POST /api/predictions/resolve
 *   Authorization: Bearer <CRON_SECRET>
 *
 * For a scheduled job (e.g. every 15 minutes) so predictions are scored even
 * when nobody opens the predictions pages. Without CRON_SECRET configured the
 * endpoint is closed.
 */
export async function POST(
  request: Request,
  _context?: unknown,
  store: PredictionStore | null = getPredictionStore(),
  prices: PriceSource = historyPrices,
  secret: string | undefined = process.env.CRON_SECRET
) {
  const header = request.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!store) {
    return NextResponse.json({ success: false, error: "Predictions aren't set up yet." }, { status: 503 });
  }

  try {
    return NextResponse.json({ success: true, ...(await resolveDue(store, prices, Date.now(), 200)) });
  } catch (error) {
    console.error("Resolve error:", error);
    return NextResponse.json({ success: false, error: "Resolve failed." }, { status: 500 });
  }
}
