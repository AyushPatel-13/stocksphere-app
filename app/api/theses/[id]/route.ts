import { NextResponse } from "next/server";

import { marketData, type PredictionMarketData } from "@/lib/predictions/v2/sources";
import {
  closeThesis,
  deleteThesis,
  getThesisStore,
  isThesisScoringEnabled,
  publishThesis,
  reviseThesis,
  type ActionResult,
  type ThesisStore,
} from "@/lib/theses/service";
import { UUID, bearerToken, thesisError } from "@/lib/theses/http";

/**
 * GET    /api/theses/<id>   The thesis, every version the viewer may see, and
 *                           its status history. Drafts only for their author.
 * PATCH  /api/theses/<id>   { action: "revise", content } | { action: "publish" } | { action: "close" }
 * DELETE /api/theses/<id>   Soft delete (the record and any outcome are kept).
 * Writes need Authorization: Bearer <access token> of the author.
 */

type Context = { params: Promise<{ id: string }> };

const notConfigured = () => NextResponse.json({ success: false, error: "Theses aren't set up yet.", code: "NOT_CONFIGURED" }, { status: 503 });
const respond = <T>(result: ActionResult<T>, extra?: (value: T) => Record<string, unknown>) =>
  result.ok
    ? NextResponse.json({ success: true, ...(extra ? extra(result.value) : {}) })
    : NextResponse.json({ success: false, error: result.error, code: result.code }, { status: result.status });

export async function GET(request: Request, context: Context, store: ThesisStore | null = getThesisStore()) {
  if (!store) return notConfigured();
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ success: false, error: "Thesis not found." }, { status: 404 });
  try {
    const token = bearerToken(request);
    const viewerId = token ? await store.verifyToken(token) : null;
    const thesis = await store.detail(id, viewerId ? token : null, viewerId);
    if (!thesis) return NextResponse.json({ success: false, error: "Thesis not found." }, { status: 404 });
    // Outcomes stay hidden until scoring has been verified in production.
    return NextResponse.json({ success: true, thesis, scoring: isThesisScoringEnabled() ? "on" : "off" });
  } catch (error) {
    return thesisError(error, "Couldn't load this thesis.");
  }
}

export async function PATCH(
  request: Request,
  context: Context,
  store: ThesisStore | null = getThesisStore(),
  market: PredictionMarketData = marketData,
  now: () => number = Date.now
) {
  if (!store) return notConfigured();
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ success: false, error: "Thesis not found." }, { status: 404 });
  let json: Record<string, unknown> | null;
  try {
    json = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
  }
  const token = bearerToken(request);
  try {
    switch (json?.action) {
      case "revise":
        return respond(await reviseThesis({ token, id, content: (json.content ?? null) as Record<string, unknown> | null }, store, now()), (v) => ({ version: v.version }));
      case "publish":
        return respond(await publishThesis({ token, id }, store, market, now()), (v) => ({ referencePrice: v.referencePrice }));
      case "close":
        return respond(await closeThesis({ token, id }, store, now()));
      default:
        return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
    }
  } catch (error) {
    return thesisError(error, "Couldn't update this thesis. Please try again.", 500);
  }
}

export async function DELETE(request: Request, context: Context, store: ThesisStore | null = getThesisStore(), now: () => number = Date.now) {
  if (!store) return notConfigured();
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ success: false, error: "Thesis not found." }, { status: 404 });
  try {
    return respond(await deleteThesis({ token: bearerToken(request), id }, store, now()));
  } catch (error) {
    return thesisError(error, "Couldn't delete this thesis. Please try again.", 500);
  }
}
