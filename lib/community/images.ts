/**
 * Photos on Community posts: the rules, as pure functions so the server and
 * the composer agree and every rule is unit-tested. Safe in the browser.
 *
 * A file's type is decided by its first bytes (its signature), never by its
 * name or the type the browser claims, and its size in pixels is read from
 * the same header, so the gallery can lay it out before it loads.
 */

export const IMAGES_BUCKET = "community-images";
export const MAX_IMAGES = 4;
/** Per file, after the browser has resized it. Under Vercel's 4.5 MB request limit. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** The longest side the browser resizes a photo down to before uploading. */
export const MAX_EDGE = 2560;
export const ALT_MAX = 200;
/** Uploads a member may make per hour, and keep unused at once. */
export const UPLOADS_PER_HOUR = 30;
export const MAX_UNUSED_UPLOADS = 12;
/** Unused uploads older than this are removed by the cleanup job. */
export const UNUSED_TTL_HOURS = 24;

export type ImageMime = "image/jpeg" | "image/png" | "image/webp";
export const IMAGE_MIMES: readonly ImageMime[] = ["image/jpeg", "image/png", "image/webp"];
export const IMAGE_ACCEPT = IMAGE_MIMES.join(",");
const EXT: Record<ImageMime, "jpg" | "png" | "webp"> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export type ImageInfo = { mime: ImageMime; ext: "jpg" | "png" | "webp"; width: number; height: number };

/** A photo as a post carries it. */
export type PostImage = { path: string; width: number; height: number; alt: string };

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function size(mime: ImageMime, width: number, height: number): ImageInfo | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 20000 || height > 20000) return null;
  return { mime, ext: EXT[mime], width, height };
}

/**
 * The real type and pixel size of a JPEG, PNG or WebP from its bytes, or
 * null for anything else (a GIF, an SVG, a renamed PDF, a truncated file).
 */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  const b = bytes;
  // PNG: signature, then the IHDR chunk with width and height.
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a && ascii(b, 12, 4) === "IHDR") {
    return size("image/png", u32be(b, 16), u32be(b, 20));
  }

  // JPEG: SOI, then walk the segments to the frame header (SOFn).
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 3 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      // Markers without a length: TEM and RSTn.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) return null; // end of image / scan before any frame header
      const length = u16be(b, i + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return i + 8 < b.length ? size("image/jpeg", u16be(b, i + 7), u16be(b, i + 5)) : null;
      if (length < 2) return null;
      i += 2 + length;
    }
    return null;
  }

  // WebP: RIFF container, then a VP8 / VP8L / VP8X chunk.
  if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return size("image/webp", (b[26] | (b[27] << 8)) & 0x3fff, (b[28] | (b[29] << 8)) & 0x3fff);
    }
    if (chunk === "VP8L" && b[20] === 0x2f) {
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      return size("image/webp", (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (chunk === "VP8X") return size("image/webp", u24le(b, 24) + 1, u24le(b, 27) + 1);
  }
  return null;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH = new RegExp(`^(${UUID})/(${UUID})\\.(jpg|png|webp)$`);

/** `<owner id>/<random id>.<ext>`: nothing guessable, nothing outside the owner's folder. */
export function imagePath(ownerId: string, id: string, ext: ImageInfo["ext"]): string {
  return `${ownerId.toLowerCase()}/${id.toLowerCase()}.${ext}`;
}

export function isImagePath(path: unknown): path is string {
  return typeof path === "string" && PATH.test(path);
}

/** The member a path's folder belongs to, or null. */
export function imageOwner(path: string): string | null {
  return PATH.exec(path)?.[1] ?? null;
}

/** The photo's public address (the bucket is public-read; names are unguessable). */
export function imageUrl(path: string, supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${IMAGES_BUCKET}/${path}`;
}

/** A post's stored images, keeping only well-formed entries (never more than MAX_IMAGES). */
export function readPostImages(raw: unknown): PostImage[] {
  if (!Array.isArray(raw)) return [];
  const images: PostImage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { path, width, height, alt } = item as Record<string, unknown>;
    if (!isImagePath(path) || typeof width !== "number" || typeof height !== "number" || width < 1 || height < 1) continue;
    images.push({ path, width, height, alt: typeof alt === "string" ? alt.slice(0, ALT_MAX) : "" });
    if (images.length === MAX_IMAGES) break;
  }
  return images;
}

export type ImageInput = { path: string; alt: string };
type Fail = { ok: false; status: number; error: string; code?: string };

/** The request's `images`: [{ path, alt? }], shape-checked. Anything malformed is refused, not ignored. */
export function parseImageInputs(raw: unknown): { ok: true; images: ImageInput[] } | Fail {
  if (raw === undefined || raw === null) return { ok: true, images: [] };
  if (!Array.isArray(raw)) return { ok: false, status: 400, error: "Invalid images." };
  if (raw.length > MAX_IMAGES) return { ok: false, status: 422, error: `Add at most ${MAX_IMAGES} photos to a post.`, code: "RULES" };
  const images: ImageInput[] = [];
  for (const item of raw) {
    const { path, alt } = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    if (!isImagePath(path)) return { ok: false, status: 400, error: "Invalid image." };
    if (alt !== undefined && alt !== null && typeof alt !== "string") return { ok: false, status: 400, error: "Invalid image description." };
    if (images.some((image) => image.path === path)) return { ok: false, status: 400, error: "The same photo was added twice." };
    images.push({ path, alt: typeof alt === "string" ? alt.replace(/\s+/g, " ").trim().slice(0, ALT_MAX) : "" });
  }
  return { ok: true, images };
}

/**
 * How a gallery of 1-4 photos is laid out, like X and Reddit: one photo
 * shows whole (its own shape, within limits); two sit side by side; three
 * are one tall photo beside two stacked; four are a 2 × 2 grid.
 */
export function galleryLayout(count: number): { grid: string; cells: string[] } {
  if (count <= 1) return { grid: "grid-cols-1", cells: [""] };
  if (count === 2) return { grid: "grid-cols-2 aspect-[16/9]", cells: ["", ""] };
  if (count === 3) return { grid: "grid-cols-2 grid-rows-2 aspect-[16/9]", cells: ["row-span-2", "", ""] };
  return { grid: "grid-cols-2 grid-rows-2 aspect-[16/9]", cells: ["", "", "", ""] };
}

/** A single photo's box: its own aspect ratio, kept between portrait 4:5 and wide 2:1. */
export function singleAspect(width: number, height: number): number {
  const ratio = width / height;
  return Math.min(2, Math.max(0.8, Number.isFinite(ratio) && ratio > 0 ? ratio : 1));
}

/** Why a picked file can't be added, before any upload, or null when it can. */
export function fileProblem(file: { type: string; size: number }): string | null {
  if (!(IMAGE_MIMES as readonly string[]).includes(file.type)) return "Only JPG, PNG and WebP photos can be added.";
  // Larger originals are fine: the browser resizes them first. This catches the absurd.
  if (file.size > 40 * 1024 * 1024) return "That photo is too large.";
  return null;
}
