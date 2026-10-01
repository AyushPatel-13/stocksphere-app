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
 * Deliberately NOT here: Content-Security-Policy and CORS. A CSP that is not
 * written against this app's actual inline styles and data flow is a
 * speculative policy that breaks pages, and CORS is currently the safe default
 * (no cross-origin headers, so the API routes stay same-origin). Both are
 * separate work.
 */

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
