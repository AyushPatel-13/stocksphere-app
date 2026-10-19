/**
 * Community @handles.
 *
 * Mirrors the database rules in supabase/migrations/…_profiles.sql exactly:
 * the database is the real guard, this gives the user an instant, friendly
 * message before a request is made. Keep the two lists in sync.
 */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;

const HANDLE_PATTERN = /^[a-z][a-z0-9_]{2,19}$/;

export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "admin", "administrator", "root", "system", "support", "help", "official",
  "moderator", "mod", "staff", "team", "security", "stocksphere",
  "stocksphere_official", "api", "login", "logout", "signup", "settings",
  "explore", "portfolio", "watchlist", "community", "onboarding", "profile",
  "sebi", "nse", "bse", "nseindia", "bseindia", "rbi", "nsdl", "cdsl",
  "upstox", "zerodha", "groww", "angelone", "stocktwits",
]);

/** Lowercase and drop a leading "@" — what the user typed, as it would be stored. */
export function normaliseHandle(input: string): string {
  return input.trim().replace(/^@/, "").toLowerCase();
}

/** null when the handle is acceptable, otherwise a message for the user. */
export function handleProblem(input: string): string | null {
  const handle = normaliseHandle(input);

  if (handle.length < HANDLE_MIN) return `Use at least ${HANDLE_MIN} characters.`;
  if (handle.length > HANDLE_MAX) return `Use at most ${HANDLE_MAX} characters.`;
  if (!/^[a-z]/.test(handle)) return "Start with a letter.";
  if (!HANDLE_PATTERN.test(handle)) return "Use only letters, numbers and underscores.";
  if (RESERVED_HANDLES.has(handle)) return "That handle is reserved.";

  return null;
}

/**
 * A starting suggestion from a Google name: "Ayush Patel" → "ayush_patel".
 * Always passes handleProblem() or returns "".
 */
export function suggestHandle(name: string | null | undefined): string {
  const base = String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9_]+/, "")
    .slice(0, HANDLE_MAX)
    .replace(/_+$/, "");

  return handleProblem(base) === null ? base : "";
}
