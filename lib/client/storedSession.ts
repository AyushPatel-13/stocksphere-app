/**
 * True when this browser holds a stored Supabase session (which may yet
 * prove expired). Pure, so it can be tested without a Supabase client.
 */
export function hasStoredSession(storage: Pick<Storage, "length" | "key"> | null): boolean {
  if (!storage) return false;
  try {
    for (let i = 0; i < storage.length; i++) {
      if (/^sb-.+-auth-token$/.test(storage.key(i) ?? "")) return true;
    }
  } catch {
    // Storage blocked (private mode, strict settings): treated as signed out until Supabase says otherwise.
  }
  return false;
}
