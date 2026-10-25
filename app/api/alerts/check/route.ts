import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/utils/cronAuth";
import { batchedQuotes, checkAlerts, getAlertStore, type AlertStore, type QuoteSource } from "@/lib/alerts/service";

/**
 * POST /api/alerts/check
 *   Authorization: Bearer <CRON_SECRET>
 *
 * For a scheduled job. Closed without CRON_SECRET configured.
 *
 * Safe to call as often as every few minutes around the clock: closed markets
 * aren't re-priced and no alert fires twice on the same price (see
 * lib/alerts/service.ts). Two callers are planned:
 *   - Vercel Cron, once a day at 22:15 UTC, after the US close (the Hobby
 *     plan allows daily jobs only, ±59 minutes) — the safety net;
 *   - Supabase pg_cron + pg_net every 5 minutes, once approved and set up
 *     (supabase/manual/alert_schedule.sql is written, not applied).
 */
export async function POST(
  request: Request,
  _context?: unknown,
  store: AlertStore | null = getAlertStore(),
  quotes: QuoteSource = batchedQuotes,
  secret: string | undefined = process.env.CRON_SECRET
) {
  const header = request.headers.get("authorization") ?? "";
  if (!isCronAuthorized(header, secret)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!store) {
    return NextResponse.json({ success: false, error: "Alerts aren't set up yet.", code: "NOT_CONFIGURED" }, { status: 503 });
  }

  try {
    return NextResponse.json({ success: true, ...(await checkAlerts(store, quotes)) });
  } catch (error) {
    console.error("Alert check error:", error);
    return NextResponse.json({ success: false, error: "Alert check failed." }, { status: 500 });
  }
}

/** Vercel Cron calls GET, with the same Bearer CRON_SECRET header. */
export async function GET(request: Request) {
  return POST(request);
}
