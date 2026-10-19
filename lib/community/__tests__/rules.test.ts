import { test } from "node:test";
import assert from "node:assert/strict";

import {
  accountAgeDays,
  checkContent,
  checkRate,
  extractCashtags,
  normaliseForDuplicate,
  postSymbols,
} from "../rules";
import { tokenize } from "../tokens";

test("cashtags: uppercase, de-duplicated, prices are not tickers", () => {
  assert.deepEqual(extractCashtags("Long $tcs and $INFY, not $100. Also $TCS again, $M&M and $BAJAJ-AUTO."), [
    "TCS",
    "INFY",
    "M&M",
    "BAJAJ-AUTO",
  ]);
  assert.deepEqual(extractCashtags("no tags here"), []);
});

test("a post's symbols start with its board and are capped at five", () => {
  assert.deepEqual(postSymbols("Compare with $INFY", "tcs"), ["TCS", "INFY"]);
  assert.deepEqual(postSymbols("$TCS too", "TCS"), ["TCS"]);
  assert.equal(postSymbols("$A1 $B2 $C3 $D4 $E5 $F6 $G7").length, 5);
});

test("ordinary market views pass", () => {
  for (const body of [
    "Q2 numbers for $HDFCBANK look weak on margins, but deposits grew 15%. Holding.",
    "Nifty may consolidate near 23,000 this week. FIIs are still net sellers.",
    "Target? I don't do targets. I like the management commentary though.",
  ]) {
    assert.deepEqual(checkContent(body, false), { ok: true, body });
  }
});

test("group promotion, tip selling and pump language are refused", () => {
  const refused = [
    "Join my telegram channel for daily calls",
    "Free calls at t.me/bestcalls",
    "https://chat.whatsapp.com/abc join now",
    "SURE SHOT stock, buy now",
    "Sure-shot target 500 tomorrow",
    "Guaranteed returns of 30% in a week",
    "100% profit jackpot call",
    "Paid tips available, DM me for tips",
    "Operator call: buy before Monday",
  ];

  for (const body of refused) {
    assert.equal(checkContent(body, true).ok, false, body);
  }
});

test("Indian phone numbers are refused in any common format", () => {
  for (const body of ["call 9876543210", "+91 98765 43210", "WhatsApp 98765-43210", "091 9876543210"]) {
    assert.equal(checkContent(body, true).ok, false, body);
  }
  // Prices and quantities are not phone numbers.
  assert.equal(checkContent("Bought 500 shares at 1234567 total", true).ok, true);
});

test("links: blocked for new accounts, at most two otherwise", () => {
  const one = "Good read: https://example.com/analysis";
  assert.equal(checkContent(one, false).ok, false);
  assert.equal(checkContent(one, true).ok, true);
  assert.equal(
    checkContent("a https://a.com b https://b.com c https://c.com", true).ok,
    false
  );
});

test("empty, too long, all-caps and repeated-character posts are refused", () => {
  assert.equal(checkContent("   ", true).ok, false);
  assert.equal(checkContent("x".repeat(1001), true).ok, false);
  assert.equal(checkContent("THIS STOCK WILL FLY TO THE MOON TOMORROW", true).ok, false);
  assert.equal(checkContent("To the moon 🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀", true).ok, false);
  assert.equal(checkContent("TCS and HDFC up today", true).ok, true);
});

test("rate limits are tighter for new accounts", () => {
  assert.equal(checkRate({ last10Minutes: 2, last24Hours: 2 }, 1).ok, true);
  assert.equal(checkRate({ last10Minutes: 3, last24Hours: 3 }, 1).ok, false);
  assert.equal(checkRate({ last10Minutes: 3, last24Hours: 3 }, 30).ok, true);
  assert.equal(checkRate({ last10Minutes: 0, last24Hours: 15 }, 1).ok, false);
  assert.equal(checkRate({ last10Minutes: 0, last24Hours: 59 }, 30).ok, true);
  assert.equal(checkRate({ last10Minutes: 0, last24Hours: 60 }, 30).ok, false);
  assert.ok(Math.abs(accountAgeDays("2026-10-16T00:00:00Z", Date.parse("2026-10-19T00:00:00Z")) - 3) < 1e-9);
});

test("duplicates are detected regardless of case, spacing and punctuation", () => {
  assert.equal(
    normaliseForDuplicate("TCS looks  strong!!"),
    normaliseForDuplicate("tcs looks strong")
  );
});

test("tokenize: cashtags, mentions and safe links become tokens; everything else is text", () => {
  const tokens = tokenize("Read https://example.com/x, then ask @ayush_p about $tcs.");

  assert.deepEqual(
    tokens.map((t) => t.type),
    ["text", "link", "text", "mention", "text", "cashtag", "text"]
  );
  assert.equal((tokens[1] as { href: string }).href, "https://example.com/x");
  assert.equal((tokens[5] as { symbol: string }).symbol, "TCS");
  assert.equal(tokens.map((t) => t.value).join(""), "Read https://example.com/x, then ask @ayush_p about $tcs.");

  // javascript: is never a link.
  assert.ok(tokenize("javascript:alert(1)").every((t) => t.type === "text"));
});
