import { test } from "node:test";
import assert from "node:assert/strict";

import { ensureDisclaimer, renderCitations, serialiseEvidence, type Evidence } from "../citations";

const evidence: Evidence[] = [
  { id: "E1", title: "Latest price, TCS", source: "Upstox", fetchedAt: "2026-10-24T06:00:00Z", asOf: "2026-10-23T10:29:00Z", data: { price: 2530 } },
  { id: "E2", title: "News: TCS wins deal", source: "Upstox", fetchedAt: "2026-10-24T06:00:00Z", asOf: "2026-10-22T08:00:00Z", url: "https://upstox.com/news/a", data: {} },
];

test("citations become numbered references with a Sources list, in order of first use", () => {
  const { answer, cited } = renderCitations("Deal reported [E2]. Price ₹2,530 [E1]. Again [E2].", evidence);
  assert.equal(cited.length, 2);
  assert.match(answer, /^Deal reported \[\[1\]\]\(https:\/\/upstox\.com\/news\/a\)\. Price ₹2,530 \[2\]\. Again \[\[1\]\]/);
  assert.match(answer, /\*\*Sources\*\*\n1\. \[News: TCS wins deal\]\(https:\/\/upstox\.com\/news\/a\) — Upstox, as of 2026-10-22 08:00 UTC\n2\. Latest price, TCS — Upstox, as of 2026-10-23 10:29 UTC/);
});

test("full-width and grouped citations are understood", () => {
  const { answer, cited } = renderCitations("A 【E1】 and B 【E2†source】 and C [E1, E2].", evidence);
  assert.equal(cited.length, 2);
  assert.doesNotMatch(answer, /【|E\d/);
});

test("a citation to evidence that doesn't exist is removed and counted", () => {
  const report = renderCitations("Claim [E9]. Real [E1].", evidence);
  assert.equal(report.unknownCitations, 1);
  assert.match(report.answer, /^Claim\. Real \[1\]\./);
});

test("made-up URLs never reach the user; retrieved ones stay", () => {
  const report = renderCitations(
    "See [the filing](https://fake.example/filing) and https://evil.example/x plus [ok](https://upstox.com/news/a).",
    evidence
  );
  assert.equal(report.removedUrls, 2);
  assert.doesNotMatch(report.answer, /fake\.example|evil\.example/);
  assert.match(report.answer, /\[ok\]\(https:\/\/upstox\.com\/news\/a\)/);
});

test("the evidence pack labels each item with its id, source and time", () => {
  const pack = serialiseEvidence(evidence);
  assert.match(pack, /^\[E1\] Latest price, TCS — source: Upstox, as of 2026-10-23T10:29:00Z\n\{"price":2530\}/);
});

test("the disclaimer is added before Sources when missing, with a note if the text was cut off", () => {
  const rendered = "## Summary\nText that stops mid\n\n**Sources**\n1. X";
  const fixed = ensureDisclaimer(rendered, "## Summary\nText that stops mid");
  assert.match(fixed, /cut short[\s\S]*not investment advice\._\n\n\*\*Sources\*\*/);
  const complete = ensureDisclaimer("Done.", "Done.");
  assert.equal(complete, "Done.\n\n_This is general information, not investment advice._");
  assert.equal(ensureDisclaimer("x. This is general information, not investment advice.", "x"), "x. This is general information, not investment advice.");
});
