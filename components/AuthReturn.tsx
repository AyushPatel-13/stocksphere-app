"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { classifyAuthReturn } from "@/lib/auth/redirects";
import { consumeReturn, forgetReturn } from "@/lib/auth/session";
import { supabase } from "@/lib/supabase";

/**
 * Finishes a return from Google on whatever page it lands on.
 *
 * The Supabase client exchanges `?code=` for a session by itself as it
 * starts (detectSessionInUrl); getSession() waits for that. Afterwards:
 * - a cancelled, refused or un-exchanged sign-in goes to /login with a fixed
 *   message instead of silently leaving the person signed out on the home page;
 * - a successful one goes back to the page that sent them to /login, if any.
 *
 * Runs once per page load, so it costs nothing on ordinary navigation.
 */
export default function AuthReturn() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;

      const failure = classifyAuthReturn(window.location.href);
      if (failure) {
        forgetReturn();
        router.replace(`/login?auth_error=${failure}`);
        return;
      }

      if (!data.session) return;
      const next = consumeReturn();
      const here = `${window.location.pathname}${window.location.search}`;
      if (next && next !== here) router.replace(next);
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
