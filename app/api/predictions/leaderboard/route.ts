import { isMissingTable } from "@/lib/watchlistRules";
import { NextResponse } from "next/server";

import { rankLeaders } from "@/lib/predictions/reputation";
import { getPredictionStore, type PredictionStore } from "@/lib/predictions/service";

/**
 * GET /api/predictions/leaderboard — members ranked by adjusted accuracy
 * (see lib/predictions/reputation.ts), eligible members first.
 */
export async function GET(
  _request?: Request,
  _context?: unknown,
  store: PredictionStore | null = getPredictionStore()
) {
  if (!store) {
    return NextResponse.json({ success: false, error: "Predictions aren't set up yet.", code: "NOT_CONFIGURED" }, { status: 503 });
  }

  try {
    const leaders = rankLeaders(await store.leaderboard(200)).slice(0, 50);
    return NextResponse.json({ success: true, leaders });
  } catch (error) {
    // Tables not created yet (the migration isn't applied): "launching soon", not a failure.
    if (isMissingTable(error as { code?: string; message?: string })) return NextResponse.json({ success: false, error: "Predictions are launching soon.", code: "NOT_CONFIGURED" }, { status: 503 });
    console.error("Leaderboard error:", error);
    return NextResponse.json({ success: false, error: "Couldn't load the leaderboard." }, { status: 503 });
  }
}
