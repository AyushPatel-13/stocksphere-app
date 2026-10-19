"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { getMyProfile } from "@/lib/profiles";
import { supabase } from "@/lib/supabase";

/**
 * Sends a signed-in user without a community profile to /onboarding.
 *
 * Only "missing" redirects. Signed-out visitors browse freely, and
 * "unavailable" (a network error, or the profiles migration not applied yet)
 * does nothing — an outage must never trap everyone on the onboarding page.
 */
const EXEMPT = ["/onboarding", "/login"];

// Once a profile is confirmed, stop asking on every navigation. Cleared on
// sign-out so the next account is checked afresh.
let confirmedUserHasProfile = false;

export default function ProfileGate() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (EXEMPT.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
      return;
    }

    let cancelled = false;

    async function check() {
      if (confirmedUserHasProfile) return;

      const result = await getMyProfile();
      if (result.status === "ok") confirmedUserHasProfile = true;
      if (!cancelled && result.status === "missing") {
        router.replace(`/onboarding?next=${encodeURIComponent(pathname)}`);
      }
    }

    check();

    // Also catch the moment someone signs in on this tab.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") confirmedUserHasProfile = false;
      if (event === "SIGNED_IN") check();
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [pathname, router]);

  return null;
}
