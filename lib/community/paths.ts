/**
 * Community URLs and ids, safe to import from client components (no
 * Supabase or provider code here).
 */

/** Upstox IPO ids are slugs ("tonbo-imaging-india-ipo"). */
export const IPO_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;

export function isIpoId(value: unknown): value is string {
  return typeof value === "string" && IPO_ID_PATTERN.test(value);
}

/** The stable URL of an IPO's community; it keeps working after listing. */
export function ipoCommunityPath(ipoId: string): string {
  return `/community/ipo/${encodeURIComponent(ipoId)}`;
}
