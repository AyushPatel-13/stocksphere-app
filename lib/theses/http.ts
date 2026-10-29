import { NextResponse } from "next/server";

import { isMissingTable } from "../watchlistRules";

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() || null : null;
}

/** Not migrated yet → "launching soon"; anything else → a plain failure. */
export function thesisError(error: unknown, message: string, status = 503) {
  if (isMissingTable(error as { code?: string; message?: string })) {
    return NextResponse.json({ success: false, error: "Theses are launching soon.", code: "NOT_CONFIGURED" }, { status: 503 });
  }
  console.error(message, (error as { message?: string })?.message ?? error);
  return NextResponse.json({ success: false, error: message }, { status });
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
