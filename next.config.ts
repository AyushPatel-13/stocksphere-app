import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * The app shipped with none — next.config.ts was an empty object — so every
 * response went out with the browser's defaults. These are the four that cost
 * nothing and cannot break rendering:
 *
 *   X-Content-Type-Options     stops a response being sniffed into a type it
 *                              did not declare.
 *   Referrer-Policy            sends the origin on cross-site navigations and
 *                              nothing more, so URLs never leak to third
 *                              parties. The app's own URLs carry a symbol and a
 *                              username.
 *   X-Frame-Options            refuses framing. /login is a real OAuth entry
 *                              point, and a framed login is the classic way to
 *                              harvest a click on it.
 *   Permissions-Policy         turns off device APIs this app never asks for,
 *                              so a future dependency cannot quietly start.
 *
 * Strict-Transport-Security is included because the production target is
 * HTTPS-only (Supabase OAuth requires an HTTPS redirect origin, and every
 * standard Next.js host terminates TLS). It is inert over plain HTTP — browsers
 * ignore the header on a non-secure connection — so `next dev` on
 * http://localhost:3000 is unaffected. `includeSubDomains` and `preload` are
 * deliberately left off: both are commitments about domains this repository
 * does not describe, and neither is needed to get the protection.
 *
 * Content-Security-Policy ships as Report-Only for now: browsers log each
 * violation to the console but block nothing, so a missed origin cannot break
 * a page. Once a beta round shows no violations, rename the header to
 * Content-Security-Policy to enforce it. The browser only talks to this app
 * and Supabase (REST, auth and realtime); market data is fetched server-side.
 * Images may come from any HTTPS host (Google avatars, news thumbnails, coin
 * logos). 'unsafe-inline' scripts are needed by Next's inline bootstrap
 * without nonces; 'unsafe-eval' only by the dev server.
 *
 * CORS is deliberately not set: no cross-origin headers, so the API routes
 * stay same-origin.
 */

const supabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return "";
  }
})();

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin} ${supabaseOrigin.replace(/^https/, "wss")}` : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000",
  },
  {
    key: "Content-Security-Policy-Report-Only",
    value: CONTENT_SECURITY_POLICY,
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Every route, including the API and the static assets.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
