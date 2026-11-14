"use client";

import { useSyncExternalStore } from "react";

import { supabase } from "@/lib/supabase";
import { hasStoredSession } from "./storedSession";

/**
 * Whether someone is signed in, for pages that show a different layout to
 * members (the home page) rather than gating on it.
 *
 * The server always renders the signed-out page. In the browser the first
 * answer is a hint, read synchronously from the session Supabase keeps in
 * localStorage, so a member's page is right before the first paint instead
 * of flashing the visitor's page. Supabase then confirms or corrects it, and
 * later sign-ins and sign-outs update it. Private data is never decided by
 * this: every private API checks the token itself.
 */

let signedIn: boolean | null = null;
const listeners = new Set<() => void>();
let subscribed = false;

function snapshot(): boolean {
  signedIn ??= hasStoredSession(typeof window === "undefined" ? null : window.localStorage);
  return signedIn;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!subscribed) {
    subscribed = true;
    // Fires once with the real session on load, then on every sign-in and sign-out.
    supabase.auth.onAuthStateChange((_event, session) => {
      const next = Boolean(session);
      if (next === signedIn) return;
      signedIn = next;
      listeners.forEach((listener) => listener());
    });
  }
  return () => {
    listeners.delete(onChange);
  };
}

export function useSignedIn(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
