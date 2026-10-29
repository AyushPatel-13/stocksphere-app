import { NextResponse } from "next/server";

import { getMarketEventStore, ingestNseEvents, type MarketEventStore } from "@/lib/markets/eventIngest";
import { isCronAuthorized } from "@/lib/utils/cronAuth";
import { isMissingTable } from "@/lib/watchlistRules";

/**
 * GET /api/events/ingest
 *   Authorization: Bearer <CRON_SECRET>
 *
 * For the scheduled job: reads NSE's corporate-action and board-meeting feeds
 * into market_events (see lib/markets/eventIngest.ts). Idempotent. Without
 * CRON_SECRET the endpoint is closed.
 */
export async function GET(
  request: Request,
  _context?: unknown,
  secret: string | undefined = process.env.CRON_SECRET,
  store: MarketEventStore | null = getMarketEventStore(),
  ingest: typeof ingestNseEvents = ingestNseEvents
) {
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!store) {
    return NextResponse.json({ success: false, error: "Market events aren't set up yet.", code: "NOT_CONFIGURED" }, { status: 503 });
  }
  try {
    return NextResponse.json({ success: true, ...(await ingest(store)) });
  } catch (error) {
    if (isMissingTable(error as { code?: string; message?: string })) {
      return NextResponse.json({ success: false, error: "The market events migration hasn't been applied.", code: "NOT_CONFIGURED" }, { status: 503 });
    }
    console.error("Market event ingest error:", error);
    return NextResponse.json({ success: false, error: "Ingest failed." }, { status: 500 });
  }
}
