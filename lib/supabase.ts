import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL!;

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * PKCE rather than the library's default implicit flow: Google sign-in now
 * returns with a one-time `?code=` that this client swaps for a session on
 * load (detectSessionInUrl), instead of putting the access and refresh tokens
 * in the URL fragment, where they land in browser history. The swap needs the
 * verifier this browser stored when the sign-in started, so a code copied
 * elsewhere is useless.
 */
export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  { auth: { flowType: "pkce" } }
);
