import { NextResponse } from "next/server";

import { MAX_IMAGES, MAX_IMAGE_BYTES } from "@/lib/community/images";
import { getImageStore, removeImages, uploadImage, type ImageStore } from "@/lib/community/imageService";

/**
 * GET    /api/community/images
 *        → { success, enabled, maxImages, maxBytes } (are photo uploads switched on?)
 * POST   /api/community/images   multipart/form-data, field `file`
 *        Authorization: Bearer <Supabase access token>
 *        → 201 { success, image: { path, width, height } }
 *        One photo per request. Type and size come from the file's bytes;
 *        anything but JPEG, PNG or WebP up to 4 MB is refused.
 * DELETE /api/community/images   { paths: string[], detached?: boolean }
 *        Authorization: Bearer <token>
 *        Removes the caller's own uploads that no post uses (and, with
 *        `detached`, those left behind by their deleted posts).
 */

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
}

export async function GET(_request: Request, _context?: unknown, store: ImageStore | null = getImageStore()) {
  let enabled = false;
  try {
    enabled = Boolean(store && (await store.ready()));
  } catch {
    enabled = false;
  }
  return NextResponse.json({ success: true, enabled, maxImages: MAX_IMAGES, maxBytes: MAX_IMAGE_BYTES });
}

export async function POST(request: Request, _context?: unknown, store: ImageStore | null = getImageStore()) {
  // Refuse an oversized body before reading it (the multipart wrapper adds a little).
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_IMAGE_BYTES + 64 * 1024) {
    return NextResponse.json({ success: false, error: "That photo is over 4 MB. Try a smaller one.", code: "TOO_LARGE" }, { status: 413 });
  }

  let bytes: Uint8Array | null = null;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (file && typeof file === "object" && "arrayBuffer" in file) bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ success: false, error: "Invalid upload." }, { status: 400 });
  }

  try {
    const result = await uploadImage({ token: bearer(request), bytes }, store);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ success: true, image: result.image }, { status: 201 });
  } catch (error) {
    console.error("Community image upload error:", error);
    return NextResponse.json({ success: false, error: "Couldn't upload that photo. Please try again." }, { status: 500 });
  }
}

export async function DELETE(request: Request, _context?: unknown, store: ImageStore | null = getImageStore()) {
  let json: Record<string, unknown> = {};
  try {
    json = ((await request.json()) as Record<string, unknown>) ?? {};
  } catch {
    json = {};
  }
  try {
    const result = await removeImages({ token: bearer(request), paths: json.paths, detached: json.detached === true }, store);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ success: true, removed: result.removed });
  } catch (error) {
    console.error("Community image remove error:", error);
    return NextResponse.json({ success: false, error: "Couldn't remove those photos." }, { status: 500 });
  }
}
