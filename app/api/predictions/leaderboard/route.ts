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
    console.error("Leaderboard error:", error);
    return NextResponse.json({ success: false, error: "Couldn't load the leaderboard." }, { status: 503 });
  }
}
