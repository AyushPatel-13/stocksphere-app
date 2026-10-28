import { test } from "node:test";
import assert from "node:assert/strict";

import { authFailureMessage, classifyAuthReturn, loginHref, safeReturnPath } from "../redirects";

test("same-site paths are kept, with their query and hash", () => {
  assert.equal(safeReturnPath("/portfolio"), "/portfolio");
  assert.equal(safeReturnPath("/stock/RELIANCE?tab=news#top"), "/stock/RELIANCE?tab=news#top");
  assert.equal(safeReturnPath("/alerts", "/explore"), "/alerts");
});

test("anything that could leave the site falls back", () => {
  const hostile = [
    "//evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/\tevil",
    "/%0a",
    "evil.com",
    "",
    null,
    undefined,
    `/${"a".repeat(600)}`,
  ];
  for (const value of hostile) {
    const out = safeReturnPath(value as string, "/explore");
    // The fallback, or at worst a harmless same-site path ("/%0a" is literal).
    assert.ok(out === "/explore" || (out.startsWith("/") && !out.startsWith("//")), `${String(value)} → ${out}`);
    assert.equal(new URL(out, "https://stocksphere.test").host, "stocksphere.test", String(value));
  }
  // The specific case the old onboarding check let through.
  assert.equal(new URL("/\\evil.com", "https://stocksphere.test").host, "evil.com");
  assert.equal(safeReturnPath("/\\evil.com", "/explore"), "/explore");
});

test("login and onboarding can't be return targets, so a return can't loop", () => {
  assert.equal(safeReturnPath("/login"), "/");
  assert.equal(safeReturnPath("/login?next=/x"), "/");
  assert.equal(safeReturnPath("/onboarding?next=/x", "/explore"), "/explore");
  assert.equal(safeReturnPath("/loginx"), "/loginx");
});

test("loginHref carries the return path only when there is one", () => {
  assert.equal(loginHref("/"), "/login");
  assert.equal(loginHref("/paper?tab=orders"), "/login?next=%2Fpaper%3Ftab%3Dorders");
  assert.equal(loginHref("//evil.com"), "/login");
});

test("a return from Google is classified from the URL", () => {
  const base = "https://stocksphere-theta.vercel.app/";
  assert.equal(classifyAuthReturn(base), null);
  assert.equal(classifyAuthReturn(`${base}portfolio`), null);
  // The person closed or declined Google's consent screen.
  assert.equal(classifyAuthReturn(`${base}?error=access_denied&error_description=User+cancelled`), "cancelled");
  assert.equal(classifyAuthReturn(`${base}#error=access_denied&error_code=403`), "cancelled");
  // Expired or reused code, or a provider error.
  assert.equal(classifyAuthReturn(`${base}?error=server_error&error_description=Unable+to+exchange`), "failed");
  assert.equal(classifyAuthReturn(`${base}#error_code=bad_code_verifier`), "failed");
  // A code the client didn't exchange (no PKCE verifier in this browser).
  assert.equal(classifyAuthReturn(`${base}?code=abc123`), "failed");
  assert.equal(classifyAuthReturn("not a url"), null);
});

test("a code still in the URL after a sign-in that worked is not a failure", () => {
  const base = "https://stocksphere-theta.vercel.app/";
  // Signed in: the exchange succeeded and the URL just hadn't been cleaned yet (or a second exchange lost the race).
  assert.equal(classifyAuthReturn(`${base}?code=abc123`, true), null);
  // An explicit error is still reported, signed in or not.
  assert.equal(classifyAuthReturn(`${base}?code=abc123&error=server_error`, true), "failed");
  assert.equal(classifyAuthReturn(`${base}?error=access_denied`, true), "cancelled");
});

test("failure messages are fixed text, never taken from the URL", () => {
  assert.match(authFailureMessage("cancelled") ?? "", /cancelled/);
  assert.match(authFailureMessage("failed") ?? "", /didn't complete/);
  assert.equal(authFailureMessage("<script>alert(1)</script>"), null);
  assert.equal(authFailureMessage(null), null);
});
