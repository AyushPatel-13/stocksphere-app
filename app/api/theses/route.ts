import { NextResponse } from "next/server";

import { marketData, type PredictionMarketData } from "@/lib/predictions/v2/sources";
import { createThesis, getThesisStore, type ThesisStore } from "@/lib/theses/service";
import { bearerToken, thesisError } from "@/lib/theses/http";
import { handleProblem, normaliseHandle } from "@/lib/validation/handle";
import { isValidSymbol } from "@/lib/validation/symbol";

/**
 * GET  /api/theses?symbol=TCS&user=<handle>&mine=1&limit=20
 *      Published theses (newest first). mine=1 with a session lists the
 *      member's own, drafts included.
 * POST /api/theses { symbol, content }   Authorization: Bearer <access token>
 *      Starts a draft (version 1).
 */
export async function GET(request: Request, _context?: unknown, store: ThesisStore | null = getThesisStore()) {
  if (!store) return NextResponse.json({ success: false, error: "Theses aren't set up yet.", code: "NOT_CONFIGURED" }, { status: 503 });

  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol")?.trim().toUpperCase().replace(/\.(NS|BO|BSE)$/, "") || undefined;
  if (symbol && !isValidSymbol(symbol)) return NextResponse.json({ success: false, error: "Invalid symbol" }, { status: 400 });
  const userParam = params.get("user");
  const username = userParam ? normaliseHandle(userParam) : undefined;
  if (username && handleProblem(username)) return NextResponse.json({ success: false, error: "Invalid user" }, { status: 400 });
  const limit = Math.min(Math.max(Number(params.get("limit")) || 20, 1), 50);

  try {
    const token = bearerToken(request);
    let mine: string | null = null;
    if (params.get("mine") === "1") {
      mine = token ? await store.verifyToken(token) : null;
      if (!mine) return NextResponse.json({ success: false, error: "Sign in to see your theses.", code: "SIGNED_OUT" }, { status: 401 });
    }
    const theses = await store.list({ symbol, username, viewerToken: mine ? token : null, mine, limit });
    return NextResponse.json({ success: true, theses });
  } catch (error) {
    return thesisError(error, "Couldn't load theses.");
  }
}

export async function POST(
  request: Request,
  _context?: unknown,
  store: ThesisStore | null = getThesisStore(),
  market: PredictionMarketData = marketData,
  now: () => number = Date.now
) {
  if (!store) return NextResponse.json({ success: false, error: "Theses aren't set up yet.", code: "NOT_CONFIGURED" }, { status: 503 });
  let json: Record<string, unknown> | null;
  try {
    json = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
  }
  try {
    const result = await createThesis(
      { token: bearerToken(request), symbol: json?.symbol, content: (json?.content ?? null) as Record<string, unknown> | null },
      store,
      market,
      now()
    );
    if (!result.ok) return NextResponse.json({ success: false, error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ success: true, id: result.value.id }, { status: 201 });
  } catch (error) {
    return thesisError(error, "Couldn't save your thesis. Please try again.", 500);
  }
}
