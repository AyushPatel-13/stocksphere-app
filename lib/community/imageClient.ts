"use client";

import { supabase } from "../supabase";
import { MAX_EDGE, MAX_IMAGE_BYTES, type ImageMime } from "./images";

/**
 * Photos from the browser: resize and re-encode before uploading, upload one
 * at a time, and take back uploads the member decides not to use.
 *
 * Re-encoding through a canvas drops everything but the pixels, so camera
 * metadata (EXIF: GPS location, device, time) never leaves the device, and a
 * 12-megapixel phone photo shrinks to a sensible size.
 */

export type UploadedImage = { path: string; width: number; height: number };

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

let status: Promise<boolean> | null = null;

/** Whether photo uploads are switched on (the storage migration is applied). Asked once per page load. */
export function photoUploadsEnabled(): Promise<boolean> {
  status ??= fetch("/api/community/images", { cache: "no-store" })
    .then((r) => r.json())
    .then((data) => Boolean(data?.enabled))
    .catch(() => {
      status = null;
      return false;
    });
  return status;
}

function encode(canvas: HTMLCanvasElement, type: ImageMime, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * The photo, at most MAX_EDGE on its longest side, upright (camera rotation
 * applied), without metadata, and under MAX_IMAGE_BYTES. PNGs (charts,
 * screenshots) stay lossless when they fit, and become WebP when they don't.
 */
export async function prepareImage(file: File): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, error: "That file couldn't be read as a photo." };
  }

  let scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const type: ImageMime = file.type === "image/png" ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg";

  for (let attempt = 0; attempt < 5; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) break;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    // First try the original format; then lossy WebP, a little smaller each time.
    const candidates: [ImageMime, number | undefined][] = attempt === 0 ? [[type, type === "image/png" ? undefined : 0.9]] : [["image/webp", 0.85 - attempt * 0.1]];
    for (const [format, quality] of candidates) {
      const blob = await encode(canvas, format, quality);
      if (blob && blob.size <= MAX_IMAGE_BYTES) {
        bitmap.close();
        return { ok: true, blob };
      }
    }
    if (attempt > 0) scale *= 0.8;
  }
  bitmap.close();
  return { ok: false, error: "That photo is too large to add, even after resizing." };
}

/** Upload one prepared photo. */
export async function uploadPhoto(blob: Blob, signal?: AbortSignal): Promise<{ ok: true; image: UploadedImage } | { ok: false; error: string; code?: string }> {
  const token = await accessToken();
  if (!token) return { ok: false, error: "Sign in to add photos.", code: "SIGNED_OUT" };
  const form = new FormData();
  form.append("file", blob, "photo");
  try {
    const response = await fetch("/api/community/images", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form, signal });
    const data = await response.json();
    return data?.success ? { ok: true, image: data.image as UploadedImage } : { ok: false, error: data?.error ?? "Couldn't upload that photo.", code: data?.code };
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") return { ok: false, error: "Upload cancelled.", code: "ABORTED" };
    return { ok: false, error: "Couldn't upload that photo. Check your connection." };
  }
}

/**
 * Take back photos you uploaded but won't post (removed from the composer,
 * a discarded draft), and with `detached`, those of posts you deleted.
 * Best effort: anything missed is removed by the daily cleanup.
 */
export async function removePhotos(paths: string[], detached = false): Promise<void> {
  if (!paths.length && !detached) return;
  const token = await accessToken();
  if (!token) return;
  try {
    await fetch("/api/community/images", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ paths, detached }),
      keepalive: true,
    });
  } catch {
    // The cleanup job removes it later.
  }
}
