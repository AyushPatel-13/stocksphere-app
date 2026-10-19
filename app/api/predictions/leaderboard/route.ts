import { NextResponse } from "next/server";

import {
  getPredictionStore,
  historyPrices,
  resolveDue,
  type PredictionStore,
  type PriceSource,
} from "@/lib/predictions/service";

/** GET /api/predictions/leaderboard — members ranked by prediction points. */
export async function GET(
  _request?: Request,
  _context?: unknown,
  store: PredictionStore | null = getPredictionStore(),
  prices: PriceSource = historyPrices
) {
  if (!store) {
    return NextResponse.json({ success: false, error: "Predictions aren't set up yet.", code: "NOT_CONFIGURED" }, { status: 503 });
  }

  try {
    await resolveDue(store, prices).catch((error) => console.error("Lazy resolve failed:", error));
    return NextResponse.json({ success: true, leaders: await store.leaderboard(50) });
  } catch (error) {
    console.error("Leaderboard error:", error);
    return NextResponse.json({ success: false, error: "Couldn't load the leaderboard." }, { status: 503 });
  }
}
