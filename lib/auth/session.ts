import { supabase } from "@/lib/supabase";

import { RETURN_KEY, safeReturnPath } from "./redirects";

/**
 * Browser-side sign-in helpers. sessionStorage is per tab and cleared when the
 * tab closes, which is the lifetime a "come back here" note should have; it
 * can be blocked (private modes), so every access is guarded.
 */

export function rememberReturn(path: string): void {
  const next = safeReturnPath(path, "/");
  try {
    if (next === "/") window.sessionStorage.removeItem(RETURN_KEY);
    else window.sessionStorage.setItem(RETURN_KEY, next);
  } catch {
    // Storage blocked: the user lands on the home page instead.
  }
}

/** The remembered path, removed as it's read so it is used once. */
export function consumeReturn(): string | null {
  try {
    const value = window.sessionStorage.getItem(RETURN_KEY);
    window.sessionStorage.removeItem(RETURN_KEY);
    return value ? safeReturnPath(value, "/") : null;
  } catch {
    return null;
  }
}

export function forgetReturn(): void {
  try {
    window.sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * End the session, then leave for /login with a full page load so no
 * in-memory state from the signed-in account survives.
 *
 * signOut() revokes the refresh token on the server. If that request fails
 * (offline, Supabase down) the library keeps the local session, which would
 * leave the person signed in after pressing "Sign out" — so the local copy is
 * then removed on its own.
 */
export async function signOutAndLeave(): Promise<void> {
  forgetReturn();
  try {
    const { error } = await supabase.auth.signOut();
    if (error) await supabase.auth.signOut({ scope: "local" });
  } catch {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
  window.location.href = "/login";
}
