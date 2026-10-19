import { NextResponse } from "next/server";

import {
  createPrediction,
  getPredictionStore,
  historyPrices,
  resolveDue,
  type PredictionStore,
  type PriceSource,
} from "@/lib/predictions/service";
import { handleProblem, normaliseHandle } from "@/lib/validation/handle";
import { isValidSymbol } from "@/lib/validation/symbol";

/**
 * GET  /api/predictions?user=<handle>&symbol=TCS&status=open|resolved&limit=30
 *      Public. Scores any predictions that have come due first, so results
 *      appear without waiting for the scheduled resolver.
 * POST /api/predictions { assetType, symbol, direction, horizon, target?, note? }
 *      Authorization: Bearer <Supabase access token>
 */

export async function GET(
  request: Request,
  _context?: unknown,
  store: PredictionStore | null = getPredictionStore(),
  prices: PriceSource = historyPrices
) {
  if (!store) {
    return NextResponse.json({ success: false, error: "Predictions aren't set up yet.", code: "NOT_CONFIGURED" }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;
  const userParam = params.get("user");
  const username = userParam ? normaliseHandle(userParam) : undefined;
  if (username && handleProblem(username)) {
    return NextResponse.json({ success: false, error: "Invalid user" }, { status: 400 });
  }

  const symbol = params.get("symbol")?.trim().toUpperCase() || undefined;
  if (symbol && !isValidSymbol(symbol)) {
    return NextResponse.json({ success: false, error: "Invalid symbol" }, { status: 400 });
  }

  const statusParam = params.get("status");
  const status = statusParam === "open" || statusParam === "resolved" ? statusParam : undefined;
  const limit = Math.min(Math.max(Number(params.get("limit")) || 30, 1), 100);

  try {
    // Best effort: a resolver hiccup must not stop the list from loading.
    await resolveDue(store, prices).catch((error) => console.error("Lazy resolve failed:", error));

    const predictions = await store.list({ username, symbol, status, limit });
    return NextResponse.json({ success: true, predictions });
  } catch (error) {
    console.error("Predictions list error:", error);
    return NextResponse.json({ success: false, error: "Couldn't load predictions." }, { status: 503 });
  }
}

export async function POST(
  request: Request,
  _context?: unknown,
  store: PredictionStore | null = getPredictionStore(),
  prices: PriceSource = historyPrices
) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;

  let json: Record<string, unknown> | null;
  try {
    json = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
  }

  try {
    const result = await createPrediction(
      {
        token,
        assetType: json?.assetType,
        symbol: json?.symbol,
        direction: json?.direction,
        horizon: json?.horizon,
        target: json?.target,
        note: json?.note,
      },
      store,
      prices
    );

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error, code: result.code }, { status: result.status });
    }
    return NextResponse.json({ success: true, prediction: result.prediction }, { status: 201 });
  } catch (error) {
    console.error("Prediction create error:", error);
    return NextResponse.json({ success: false, error: "Couldn't save your prediction. Please try again." }, { status: 500 });
  }
}
