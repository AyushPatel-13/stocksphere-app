import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Whether a scheduled-job request carries "Authorization: Bearer <CRON_SECRET>".
 *
 * Closed when no secret is configured. Compared in constant time (on SHA-256
 * digests, so the lengths always match): a plain `!==` returns sooner the
 * earlier the first wrong character is, which leaks the secret a character at
 * a time to anyone patient enough to measure it.
 */
export function isCronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}
