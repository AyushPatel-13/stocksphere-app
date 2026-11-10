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
const u32le = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
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

/**
 * The same photo without the metadata cameras and phones write into it —
 * EXIF (which can hold the GPS position it was taken at, and a thumbnail of
 * the uncropped original), XMP, IPTC, comments, text chunks, and anything
 * appended after the image ends — or null when the file isn't well formed.
 *
 * The composer's re-encode already drops all of this; this is the server's
 * guarantee for an upload that skipped the composer. Image data and the
 * colour profile are kept byte for byte, so nothing is re-compressed. EXIF
 * orientation goes with the rest: the composer has already applied it.
 */
export function stripImageMetadata(bytes: Uint8Array, mime: ImageMime): Uint8Array | null {
  if (mime === "image/jpeg") return stripJpeg(bytes);
  if (mime === "image/png") return stripPng(bytes);
  return stripWebp(bytes);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** JPEG segments kept: JFIF (without its thumbnail), Adobe's colour transform, and the ICC colour profile. */
function keptJpegSegment(marker: number, segment: Uint8Array): Uint8Array | null {
  const data = segment.subarray(4);
  if (marker === 0xfe) return null; // comment
  if (marker < 0xe0 || marker > 0xef) return segment; // not an APPn: tables, frame header, restart interval
  if (marker === 0xe0 && data.length >= 14 && ascii(data, 0, 5) === "JFIF\0") {
    const jfif = new Uint8Array(18);
    jfif.set([0xff, 0xe0, 0x00, 0x10]);
    jfif.set(data.subarray(0, 12), 4); // version, units, density; thumbnail size left at 0 × 0
    return jfif;
  }
  if (marker === 0xee && ascii(data, 0, 5) === "Adobe") return segment;
  if (marker === 0xe2 && ascii(data, 0, 12) === "ICC_PROFILE\0") return segment;
  return null;
}

function stripJpeg(b: Uint8Array): Uint8Array | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let scanned = false;
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0xd9) {
      // End of image: anything after it is dropped.
      if (!scanned) return null;
      parts.push(b.subarray(i, i + 2));
      return concat(parts);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > b.length) return null;
    const end = i + 2 + u16be(b, i + 2);
    if (end < i + 4 || end > b.length) return null;
    const kept = keptJpegSegment(marker, b.subarray(i, end));
    if (kept) parts.push(kept);
    i = end;
    if (marker === 0xda) {
      // The scan's compressed data runs to the next marker that isn't a
      // stuffed 0xFF00 or a restart marker. Progressive files have several
      // scans, so segments after this one are checked too.
      scanned = true;
      let j = i;
      while (j + 1 < b.length && !(b[j] === 0xff && b[j + 1] !== 0x00 && !(b[j + 1] >= 0xd0 && b[j + 1] <= 0xd7))) j++;
      if (j + 1 >= b.length) return null;
      parts.push(b.subarray(i, j));
      i = j;
    }
  }
  return null;
}

/** PNG chunks dropped: EXIF, the three text kinds (where XMP and comments live) and the last-modified time. */
const PNG_DROPPED = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(b: Uint8Array): Uint8Array | null {
  if (b.length < 8 || b[0] !== 0x89 || ascii(b, 1, 3) !== "PNG") return null;
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + u32be(b, i);
    if (end > b.length) return null;
    if (!PNG_DROPPED.has(type)) parts.push(b.subarray(i, end));
    if (type === "IEND") return concat(parts); // anything after it is dropped
    i = end;
  }
  return null;
}

/** VP8X header flags for the EXIF and XMP chunks, cleared once those chunks are dropped. */
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function stripWebp(b: Uint8Array): Uint8Array | null {
  if (b.length < 20 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const riffEnd = 8 + u32le(b, 4);
  if (riffEnd < 20 || riffEnd > b.length) return null;
  const parts: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= riffEnd) {
    const type = ascii(b, i, 4);
    const size = u32le(b, i + 4);
    if (i + 8 + size > riffEnd) return null;
    const end = Math.min(i + 8 + size + (size & 1), riffEnd); // chunks are padded to an even length
    if (type !== "EXIF" && type !== "XMP ") {
      let chunk = b.subarray(i, end);
      if (type === "VP8X" && size >= 1) {
        chunk = chunk.slice();
        chunk[8] &= ~(VP8X_EXIF | VP8X_XMP);
      }
      parts.push(chunk);
    }
    i = end;
  }
  if (i !== riffEnd || parts.length === 0) return null;

  const body = concat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(b.subarray(0, 4));
  new DataView(out.buffer).setUint32(4, 4 + body.length, true);
  out.set(b.subarray(8, 12), 8);
  out.set(body, 12);
  return out;
}

const UUID ="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
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
