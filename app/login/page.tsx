"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * The auth card's stylesheet.
 *
 * Kept in the file rather than inline so :hover, :focus-visible, the pending
 * state and the reduced-motion fallback can be expressed — inline styles cannot
 * carry pseudo-classes or media queries. Same convention as
 * app/stock/[symbol]/page.tsx and app/stock/[symbol]/loading.tsx.
 *
 * The palette is the app's: #000 page, #111 surface, 1px solid #222 border,
 * #888/#777 muted text, green #22c55e with black text for the primary action.
 * The button is the navbar's Login button — green with black text, not the
 * white-on-green it used to be, which was about 2.1:1 and failed contrast.
 */
const LOGIN_STYLES = `
.auth-root {
  background: #000;
  color: #fff;
  /* The navbar lives in the root layout, outside this page. It renders 65px:
     64px from the h-16 class plus its own 1px bottom border. Subtracting only
     64 left exactly 1px of overflow, which was enough to summon a 15px
     scrollbar gutter at every width. */
  min-height: calc(100vh - 65px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 16px 72px;
}
.auth-card {
  width: 100%;
  max-width: 420px;
  background: #111;
  border: 1px solid #222;
  border-radius: 20px;
  padding: 32px 24px;
  text-align: center;
}
.auth-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.auth-logo {
  border-radius: 16px;
}
.auth-wordmark {
  margin-top: 14px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.auth-wordmark span {
  color: #22c55e;
}
.auth-tagline {
  margin-top: 6px;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #777;
}
.auth-title {
  margin: 26px 0 0;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.auth-sub {
  margin: 8px 0 0;
  font-size: 14px;
  line-height: 1.6;
  color: #888;
}
.auth-google {
  margin-top: 26px;
  width: 100%;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 13px 20px;
  border: none;
  border-radius: 12px;
  background: #22c55e;
  color: #000;
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s ease, transform 0.15s ease;
}
.auth-google:hover:not(:disabled) {
  background: #35d477;
}
.auth-google:active:not(:disabled) {
  transform: translateY(1px);
}
.auth-google:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px #111, 0 0 0 4px rgba(34, 197, 94, 0.6);
}
.auth-google:disabled {
  background: #1c8a4a;
  color: rgba(0, 0, 0, 0.7);
  cursor: progress;
}
.auth-spinner {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(0, 0, 0, 0.25);
  border-top-color: #000;
  animation: auth-spin 0.7s linear infinite;
}
@keyframes auth-spin {
  to { transform: rotate(360deg); }
}
@media (min-width: 640px) {
  .auth-card { padding: 40px 32px; }
}
@media (prefers-reduced-motion: reduce) {
  .auth-google { transition: none; }
  .auth-google:active:not(:disabled) { transform: none; }
  .auth-spinner { animation-duration: 1.8s; }
}
`;

/** The Google mark, drawn in currentColor so it reads on the green button. */
function GoogleMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.42 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

/**
 * Where Supabase sends the user back to after Google sign-in.
 *
 * This used to be the literal "http://localhost:3000". That worked on a dev
 * server and broke every production sign-in, because Google returned the user
 * to their own machine instead of the deployed site.
 *
 * NEXT_PUBLIC_SITE_URL is the explicit setting: a deployment sets it to its own
 * origin (https://example.com). It is a NEXT_PUBLIC_ variable because this runs
 * in the browser — it carries a public origin, never anything secret.
 *
 * With nothing configured the browser's own origin is used, which is correct by
 * construction rather than by guessing: on a dev server it is
 * http://localhost:3000, and on a deployed site it is that site's origin. That
 * is why there is no hardcoded fallback — a fallback to a domain we picked
 * would be a guess, and a wrong one would send sign-ins somewhere nobody
 * intended. Read when the button is pressed, so it is the origin the user is
 * actually on.
 */
function getOAuthRedirectUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    window.location.origin
  );
}

export default function LoginPage() {
  const [redirecting, setRedirecting] = useState(false);

  /**
   * The pending state has to survive the hand-off to be worth having.
   *
   * Clearing the flag in a `finally` looked equivalent but was not: for the
   * implicit flow `signInWithOAuth` builds the URL and calls
   * `window.location.assign`, so it settles in the same tick as the click.
   * React then batched `setRedirecting(true)` and `setRedirecting(false)` into
   * a single render and the disabled button and spinner never painted at all —
   * measured as zero frames of `disabled` over 2.5s. Now the flag is only
   * cleared when the call reports a failure, which is the one case where the
   * page stays put and the button needs to be pressable again.
   *
   * The bfcache case is the other way back to this page: returning from
   * Google's consent screen restores the document as it was left, mid-pending.
   */
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setRedirecting(false);
    };

    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const signInWithGoogle = async () => {
    setRedirecting(true);

    try {
      // Unchanged: same provider, same flow. Only the redirect target is now
      // configuration instead of a hardcoded localhost origin.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: getOAuthRedirectUrl(),
        },
      });

      if (error) setRedirecting(false);
    } catch (err) {
      // Re-thrown, so a rejection still surfaces exactly as it did before the
      // button had a pending state to manage.
      setRedirecting(false);
      throw err;
    }
  };

  return (
    <div className="auth-root">
      <style>{LOGIN_STYLES}</style>

      <main className="auth-card">
        <div className="auth-brand">
          <Image
            src="/stocksphere-logo.png"
            alt="StockSphere"
            width={64}
            height={64}
            className="auth-logo"
            priority
          />

          <div className="auth-wordmark">
            Stock<span>Sphere</span>
          </div>

          <div className="auth-tagline">
            Where Investors Think Together
          </div>
        </div>

        <h1 className="auth-title">Sign in</h1>

        <p className="auth-sub">
          Continue with your Google account to reach your portfolio,
          watchlist and predictions.
        </p>

        <button
          type="button"
          onClick={signInWithGoogle}
          disabled={redirecting}
          aria-busy={redirecting}
          className="auth-google"
        >
          {redirecting ? (
            <>
              <span className="auth-spinner" aria-hidden="true" />
              Redirecting to Google…
            </>
          ) : (
            <>
              <GoogleMark />
              Continue with Google
            </>
          )}
        </button>
      </main>
    </div>
  );
}
