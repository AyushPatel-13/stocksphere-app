"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

import AuthGuard from "@/components/AuthGuard";
import { inputClass, primaryButtonClass } from "@/components/ui/Page";
import { createMyProfile, getMyProfile, isHandleAvailable } from "@/lib/profiles";
import { safeReturnPath } from "@/lib/auth/redirects";
import { supabase } from "@/lib/supabase";
import { HANDLE_MAX, handleProblem, normaliseHandle, suggestHandle } from "@/lib/validation/handle";

/**
 * Pick your @handle.
 *
 * Shown once, after the first Google sign-in (components/ProfileGate.tsx sends
 * users here). The handle is the user's public identity in the community, so
 * it is unique, can't impersonate the platform/exchanges/regulators, and the
 * user agrees to the community rules before posting anything.
 */

/**
 * Only same-site paths, so ?next= can't bounce the user to another site.
 * The shared check also refuses "/\evil.com", which the old prefix test let
 * through and browsers read as a link to evil.com.
 */
function safeNext(value: string | null): string {
  return safeReturnPath(value, "/explore");
}

type Availability = "idle" | "checking" | "available" | "taken" | "unknown";

const RULES = [
  "Share your own views — not paid tips, “sure-shot targets” or signals.",
  "No promoting Telegram/WhatsApp groups, referral links or paid courses.",
  "Be respectful. No abuse, spam or fake accounts.",
  "Nothing here is investment advice. Do your own research.",
];

function OnboardingForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));

  const [user, setUser] = useState<User | null>(null);
  const [setup, setSetup] = useState<"loading" | "ready" | "unavailable">("loading");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [availability, setAvailability] = useState<Availability>("idle");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Already has a profile → nothing to do here. No profile → prefill from Google.
  useEffect(() => {
    let cancelled = false;

    getMyProfile().then(async (result) => {
      if (cancelled) return;

      if (result.status === "ok") {
        router.replace(next);
        return;
      }
      if (result.status === "unavailable") {
        setSetup("unavailable");
        return;
      }

      const { data } = await supabase.auth.getUser();
      if (cancelled) return;

      const name = data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || "";
      setUser(data.user);
      setDisplayName(String(name).slice(0, 50));
      setHandle(suggestHandle(name));
      setSetup("ready");
    });

    return () => {
      cancelled = true;
    };
  }, [next, router]);

  const problem = handle ? handleProblem(handle) : null;
  const username = normaliseHandle(handle);

  // Live availability, debounced so typing doesn't send a request per key.
  useEffect(() => {
    if (!username || handleProblem(username) !== null) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setAvailability("checking");
      const free = await isHandleAvailable(username);
      if (!cancelled) {
        setAvailability(free === null ? "unknown" : free ? "available" : "taken");
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [username]);

  async function submit() {
    if (problem || !username) {
      setError(problem ?? "Choose a handle.");
      return;
    }
    if (!agreed) {
      setError("Please agree to the community rules.");
      return;
    }

    setSaving(true);
    setError(null);

    const avatar = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null;
    const result = await createMyProfile({ handle: username, displayName, avatarUrl: avatar });

    if (result.ok) {
      router.replace(next);
      return;
    }

    if (result.reason === "taken") setAvailability("taken");
    setError(result.message);
    setSaving(false);
  }

  if (setup === "loading") {
    return <div className="mx-auto h-96 max-w-md animate-pulse rounded-2xl bg-[#111]" />;
  }

  if (setup === "unavailable") {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-[#222] bg-[#111] p-6 text-center">
        <p className="font-semibold">Profiles aren&apos;t available yet</p>
        <p className="mt-2 text-sm text-[#888]">
          We couldn&apos;t reach the profile service. You can keep using StockSphere and pick your
          handle later.
        </p>
      </div>
    );
  }

  const status =
    problem ??
    (availability === "checking"
      ? "Checking…"
      : availability === "available"
        ? `@${username} is available`
        : availability === "taken"
          ? `@${username} is taken`
          : availability === "unknown"
            ? "Couldn't check availability right now"
            : "");

  const statusColor =
    problem || availability === "taken"
      ? "text-[#f87171]"
      : availability === "available"
        ? "text-[#4ade80]"
        : "text-[#888]";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="mx-auto max-w-md rounded-2xl border border-[#222] bg-[#111] p-6 sm:p-8"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#22c55e]">Welcome</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Pick your handle</h1>
      <p className="mt-2 text-sm text-[#888]">
        This is how the StockSphere community will know you. You can&apos;t share it with anyone
        else.
      </p>

      <label className="mt-6 block">
        <span className="mb-1.5 block text-xs font-medium text-[#888]">Handle</span>
        <div className="flex items-center rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] focus-within:border-[#22c55e]/70">
          <span className="pl-3.5 text-sm text-[#666]">@</span>
          <input
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value.replace(/^@/, "").toLowerCase());
              setAvailability("idle");
              setError(null);
            }}
            maxLength={HANDLE_MAX}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="your_handle"
            aria-describedby="handle-status"
            className="w-full bg-transparent px-1.5 py-2.5 text-sm text-white outline-none placeholder:text-[#666]"
          />
        </div>
        <span id="handle-status" aria-live="polite" className={`mt-1.5 block min-h-[1.25rem] text-xs ${statusColor}`}>
          {status || "3–20 characters: letters, numbers, underscores."}
        </span>
      </label>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-xs font-medium text-[#888]">Display name</span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={50}
          placeholder="Your name"
          className={inputClass}
        />
      </label>

      <div className="mt-6 rounded-xl border border-[#262626] bg-[#0d0d0d] p-4">
        <p className="text-sm font-semibold">Community rules</p>
        <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-[#9a9a9a]">
          {RULES.map((rule) => (
            <li key={rule} className="flex gap-2">
              <span aria-hidden="true" className="text-[#22c55e]">•</span>
              {rule}
            </li>
          ))}
        </ul>
        <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#22c55e]"
          />
          I agree to the community rules
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-[#f87171]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving || !agreed || !!problem || !username || availability === "taken"}
        className={`${primaryButtonClass} mt-6 w-full`}
      >
        {saving ? "Saving…" : "Join StockSphere"}
      </button>
    </form>
  );
}

export default function OnboardingPage() {
  return (
    <AuthGuard>
      <main className="min-h-[calc(100vh_-_65px)] bg-black px-4 py-12 text-white">
        {/* useSearchParams needs a Suspense boundary in the App Router. */}
        <Suspense fallback={<div className="mx-auto h-96 max-w-md animate-pulse rounded-2xl bg-[#111]" />}>
          <OnboardingForm />
        </Suspense>
      </main>
    </AuthGuard>
  );
}
