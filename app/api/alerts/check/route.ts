import { NextResponse } from "next/server";

import { checkAlerts, getAlertStore, historyQuotes, type AlertStore, type QuoteSource } from "@/lib/alerts/service";

/**
 * POST /api/alerts/check
 *   Authorization: Bearer <CRON_SECRET>
 *
 * For a scheduled job (e.g. every 5 minutes during market hours). Closed
 * without CRON_SECRET configured.
 */
export async function POST(
  request: Request,
  _context?: unknown,
  store: AlertStore | null = getAlertStore(),
  quotes: QuoteSource = historyQuotes,
  secret: string | undefined = process.env.CRON_SECRET
) {
  const header = request.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) {
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
