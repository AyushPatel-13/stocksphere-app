/**
 * Where sign-in sends people, and what a failed return from Google means.
 *
 * Pure functions, so the rules are tested without a browser. The browser side
 * (sessionStorage, the Supabase client) lives in lib/auth/session.ts.
 */

/** sessionStorage key for "take me back here after Google". */
export const RETURN_KEY = "stocksphere.auth.returnTo";

/**
 * A same-site path, or the fallback.
 *
 * Only "/something" is accepted. "//evil.com" and "/\evil.com" are refused
 * because browsers read both as a link to another host, and so is anything
 * with a control character, which some parsers strip before resolving.
 * /login and /onboarding are refused too, so a return can't loop.
 */
export function safeReturnPath(value: string | null | undefined, fallback = "/"): string {
  if (!value || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  let parsed: URL;
  try {
    parsed = new URL(value, "https://stocksphere.invalid");
  } catch {
    return fallback;
  }
  if (parsed.origin !== "https://stocksphere.invalid") return fallback;
  const path = parsed.pathname;
  if (path === "/login" || path.startsWith("/login/") || path === "/onboarding" || path.startsWith("/onboarding/")) {
    return fallback;
  }
  return `${path}${parsed.search}${parsed.hash}`;
}

/** /login, carrying where to come back to when that isn't the home page. */
export function loginHref(returnTo: string): string {
  const next = safeReturnPath(returnTo, "/");
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}

export type AuthFailure = "cancelled" | "failed";

/**
 * What the URL says about a sign-in that just came back, read after the
 * Supabase client has finished its own URL handling.
 *
 * - `?error=access_denied`: the person closed or declined Google's screen.
 * - any other `error`/`error_code`/`error_description`: Google or Supabase
 *   refused (an expired or reused code, a provider error).
 * - a `?code=` still present: the client didn't exchange it. On success it
 *   removes the code, so one left behind means the exchange failed or this
 *   browser has no matching PKCE verifier (sign-in started on another address).
 *
 * Supabase puts these in the query for PKCE and in the fragment for errors on
 * some paths, so both are read.
 *
 * `signedIn`: whether a session exists now. A `?code=` can still be in the
 * address bar after the exchange worked (the URL is cleaned a moment later,
 * or a second exchange of the same code lost the race), so with a session
 * a leftover code is not a failure. Explicit error parameters still are.
 */
export function classifyAuthReturn(href: string, signedIn = false): AuthFailure | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const params = new URLSearchParams(url.search);
  const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const read = (key: string) => params.get(key) ?? fragment.get(key);

  const error = read("error");
  const errorCode = read("error_code");
  if (error || errorCode || read("error_description")) {
    return error === "access_denied" ? "cancelled" : "failed";
  }
  if (params.get("code") && !signedIn) return "failed";
  return null;
}

/** Fixed wording: nothing from the URL is ever echoed back onto the page. */
export function authFailureMessage(kind: string | null): string | null {
  if (kind === "cancelled") return "Google sign-in was cancelled. You can try again whenever you're ready.";
  if (kind === "failed") {
    return "That sign-in didn't complete. The link may have expired, or it was started on a different StockSphere address. Please try again from this page.";
  }
  return null;
}
