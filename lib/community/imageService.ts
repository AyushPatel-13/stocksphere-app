import { getAdminClient } from "../supabase/server";
import {
  IMAGES_BUCKET,
  MAX_IMAGE_BYTES,
  MAX_UNUSED_UPLOADS,
  UNUSED_TTL_HOURS,
  UPLOADS_PER_HOUR,
  imagePath,
  isImagePath,
  sniffImage,
  type ImageInfo,
} from "./images";

/**
 * Community photo uploads, on the server. Members never write to Storage
 * themselves: this checks the session, reads the file's real type and size
 * from its bytes, applies the upload limits, then stores it with the service
 * role under `<member id>/<random id>.<ext>` and records it in
 * community_uploads. A post can only use the author's own unused uploads
 * (createPost checks that), and anything left unused is removed.
 */

export type UploadRecord = { path: string; userId: string; mime: string; bytes: number; width: number; height: number; postId: string | null };

export interface ImageStore {
  /** Whether the bucket and the uploads table exist (the migration is applied). */
  ready(): Promise<boolean>;
  verifyToken(token: string): Promise<string | null>;
  hasProfile(userId: string): Promise<boolean>;
  countSince(userId: string, sinceIso: string): Promise<number>;
  countUnused(userId: string): Promise<number>;
  /** Store the bytes, then record the upload; if recording fails the stored object is removed. */
  save(path: string, bytes: Uint8Array, info: ImageInfo, userId: string): Promise<void>;
  /** The member's own uploads that no post uses, among `paths`. */
  unused(userId: string, paths: string[]): Promise<UploadRecord[]>;
  /** Remove uploads (storage objects and records). */
  remove(paths: string[]): Promise<void>;
  /** Uploads to clean up: unused and older than `beforeIso`, or left behind by a deleted post. */
  orphans(beforeIso: string, limit: number): Promise<string[]>;
  /** Of `userId`'s uploads, those whose post was deleted. */
  detached(userId: string): Promise<string[]>;
}

export type UploadResult =
  | { ok: true; image: { path: string; width: number; height: number } }
  | { ok: false; status: number; error: string; code?: string };

const OFF = { ok: false, status: 503, error: "Photo uploads aren't switched on yet.", code: "NOT_CONFIGURED" } as const;

export async function uploadImage(
  input: { token: string | null; bytes: Uint8Array | null },
  store: ImageStore | null,
  now: number = Date.now(),
  newId: () => string = () => crypto.randomUUID()
): Promise<UploadResult> {
  if (!store) return OFF;
  if (!input.token) return { ok: false, status: 401, error: "Sign in to add photos.", code: "SIGNED_OUT" };
  const userId = await store.verifyToken(input.token);
  if (!userId) return { ok: false, status: 401, error: "Your session expired. Please sign in again.", code: "SIGNED_OUT" };
  if (!(await store.ready())) return OFF;
  if (!(await store.hasProfile(userId))) return { ok: false, status: 403, error: "Pick your @handle before posting.", code: "NO_PROFILE" };

  if (!input.bytes || input.bytes.length === 0) return { ok: false, status: 400, error: "Choose a photo to upload." };
  if (input.bytes.length > MAX_IMAGE_BYTES) return { ok: false, status: 413, error: "That photo is over 4 MB, even after resizing. Try a smaller one.", code: "TOO_LARGE" };
  const info = sniffImage(input.bytes);
  if (!info) return { ok: false, status: 415, error: "Only JPG, PNG and WebP photos can be added.", code: "BAD_TYPE" };

  const [recent, unused] = await Promise.all([store.countSince(userId, new Date(now - 3_600_000).toISOString()), store.countUnused(userId)]);
  if (recent >= UPLOADS_PER_HOUR) return { ok: false, status: 429, error: "You've added a lot of photos in the last hour. Please wait a bit.", code: "RATE_LIMITED" };
  if (unused >= MAX_UNUSED_UPLOADS) return { ok: false, status: 429, error: "Post or remove the photos you've already added first.", code: "RATE_LIMITED" };

  const path = imagePath(userId, newId(), info.ext);
  await store.save(path, input.bytes, info, userId);
  return { ok: true, image: { path, width: info.width, height: info.height } };
}

/**
 * A member takes photos back before posting (removed from the composer, a
 * discarded draft), or tidies up after deleting a post. Only their own
 * uploads that no post uses are removed; anything else is left alone.
 */
export async function removeImages(
  input: { token: string | null; paths: unknown; detached?: boolean },
  store: ImageStore | null
): Promise<{ ok: true; removed: number } | { ok: false; status: number; error: string; code?: string }> {
  if (!store) return OFF;
  if (!input.token) return { ok: false, status: 401, error: "Sign in first.", code: "SIGNED_OUT" };
  const userId = await store.verifyToken(input.token);
  if (!userId) return { ok: false, status: 401, error: "Your session expired. Please sign in again.", code: "SIGNED_OUT" };

  const paths = Array.isArray(input.paths) ? input.paths : [];
  if (paths.length > MAX_UNUSED_UPLOADS || !paths.every(isImagePath)) return { ok: false, status: 400, error: "Invalid photos." };
  if (!(await store.ready())) return OFF;

  const own = paths.length ? (await store.unused(userId, paths as string[])).map((r) => r.path) : [];
  const left = input.detached ? await store.detached(userId) : [];
  const all = [...new Set([...own, ...left])];
  if (all.length) await store.remove(all);
  return { ok: true, removed: all.length };
}

/** The scheduled job: removes unused uploads older than a day and those left by deleted posts. */
export async function cleanUpImages(store: ImageStore | null, now: number = Date.now(), batch = 200): Promise<{ ok: true; removed: number } | { ok: false; status: number; error: string }> {
  if (!store || !(await store.ready())) return { ok: false, status: 503, error: "Photo uploads aren't switched on." };
  const paths = await store.orphans(new Date(now - UNUSED_TTL_HOURS * 3_600_000).toISOString(), batch);
  if (paths.length) await store.remove(paths);
  return { ok: true, removed: paths.length };
}

/* ------------------------------------------------------------------ */
/* Supabase-backed store                                               */
/* ------------------------------------------------------------------ */

const MISSING = ["42P01", "PGRST205", "42703"];

export function getImageStore(): ImageStore | null {
  const admin = getAdminClient();
  if (!admin) return null;
  let readyCache: { at: number; value: boolean } | null = null;

  return {
    async ready() {
      // Checked at most once a minute per server instance.
      if (readyCache && Date.now() - readyCache.at < 60_000) return readyCache.value;
      const [bucket, table] = await Promise.all([
        admin.storage.getBucket(IMAGES_BUCKET),
        admin.from("community_uploads").select("path", { count: "exact", head: true }).limit(1),
      ]);
      const value = !bucket.error && Boolean(bucket.data) && !(table.error && MISSING.includes(table.error.code ?? ""));
      readyCache = { at: Date.now(), value };
      return value;
    },

    async verifyToken(token) {
      const { data, error } = await admin.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },

    async hasProfile(userId) {
      const { data } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
      return Boolean(data);
    },

    async countSince(userId, sinceIso) {
      const { count, error } = await admin.from("community_uploads").select("path", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", sinceIso);
      if (error) throw error;
      return count ?? 0;
    },

    async countUnused(userId) {
      const { count, error } = await admin.from("community_uploads").select("path", { count: "exact", head: true }).eq("user_id", userId).is("post_id", null).is("attached_at", null);
      if (error) throw error;
      return count ?? 0;
    },

    async save(path, bytes, info, userId) {
      const stored = await admin.storage.from(IMAGES_BUCKET).upload(path, bytes, { contentType: info.mime, upsert: false, cacheControl: "31536000" });
      if (stored.error) throw stored.error;
      const { error } = await admin.from("community_uploads").insert({ path, user_id: userId, mime: info.mime, bytes: bytes.length, width: info.width, height: info.height });
      if (error) {
        // Never leave a stored file without a record (it could never be cleaned up).
        await admin.storage.from(IMAGES_BUCKET).remove([path]);
        throw error;
      }
    },

    async unused(userId, paths) {
      const { data, error } = await admin
        .from("community_uploads")
        .select("path, user_id, mime, bytes, width, height, post_id")
        .eq("user_id", userId)
        .is("post_id", null)
        .is("attached_at", null)
        .in("path", paths);
      if (error) throw error;
      return (data ?? []).map((r) => ({ path: r.path, userId: r.user_id, mime: r.mime, bytes: r.bytes, width: r.width, height: r.height, postId: r.post_id }));
    },

    async remove(paths) {
      // Storage first: a record without a file is harmless; a file without a record would be stranded.
      const { error } = await admin.storage.from(IMAGES_BUCKET).remove(paths);
      if (error) throw error;
      const deleted = await admin.from("community_uploads").delete().in("path", paths);
      if (deleted.error) throw deleted.error;
    },

    async orphans(beforeIso, limit) {
      const [stale, left] = await Promise.all([
        admin.from("community_uploads").select("path").is("post_id", null).is("attached_at", null).lt("created_at", beforeIso).limit(limit),
        admin.from("community_uploads").select("path").is("post_id", null).not("attached_at", "is", null).limit(limit),
      ]);
      if (stale.error) throw stale.error;
      if (left.error) throw left.error;
      return [...(stale.data ?? []), ...(left.data ?? [])].map((r) => r.path as string).slice(0, limit);
    },

    async detached(userId) {
      const { data, error } = await admin.from("community_uploads").select("path").eq("user_id", userId).is("post_id", null).not("attached_at", "is", null).limit(MAX_UNUSED_UPLOADS * 4);
      if (error) throw error;
      return (data ?? []).map((r) => r.path as string);
    },
  };
}
