import { NextResponse } from "next/server";

import { computeReputation, isReputationEnabled } from "@/lib/reputation/compute";
import { getReputationStore, type ReputationStore } from "@/lib/reputation/service";
import { handleProblem, normaliseHandle } from "@/lib/validation/handle";
import { isMissingTable } from "@/lib/watchlistRules";

/**
 * GET /api/reputation?user=<handle>
 *   A member's reputation dimensions, each with its sample size. Off (404,
 *   REPUTATION_OFF) until REPUTATION_ENABLED=true, which waits for the
 *   prediction resolver to have run in production.
 */
export async function GET(
  request: Request,
  _context?: unknown,
  store: ReputationStore | null = getReputationStore(),
  enabled: boolean = isReputationEnabled(),
  now: () => number = Date.now
) {
  if (!enabled) return NextResponse.json({ success: false, error: "Reputation isn't switched on yet.", code: "REPUTATION_OFF" }, { status: 404 });
  if (!store) return NextResponse.json({ success: false, error: "Reputation isn't set up yet.", code: "NOT_CONFIGURED" }, { status: 503 });

  const raw = new URL(request.url).searchParams.get("user");
  const username = raw ? normaliseHandle(raw) : "";
  if (!username || handleProblem(username)) return NextResponse.json({ success: false, error: "Invalid user" }, { status: 400 });

  try {
    const id = await store.memberId(username);
    if (!id) return NextResponse.json({ success: false, error: "Member not found." }, { status: 404 });
    const reputation = computeReputation(await store.inputs(id, now()));
    return NextResponse.json({ success: true, username, ...reputation }, { headers: { "Cache-Control": "public, s-maxage=300" } });
  } catch (error) {
    if (isMissingTable(error as { code?: string; message?: string })) {
      return NextResponse.json({ success: false, error: "Reputation is launching soon.", code: "NOT_CONFIGURED" }, { status: 503 });
    }
    console.error("Reputation error:", (error as { message?: string })?.message ?? error);
    return NextResponse.json({ success: false, error: "Couldn't load reputation." }, { status: 503 });
  }
}
