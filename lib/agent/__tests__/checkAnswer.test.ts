import { test } from "node:test";
import assert from "node:assert/strict";

import { AGENT_SYSTEM_PROMPT } from "../llm/prompts";
import { checkAnswer } from "../orchestrator";
import type { ToolResult } from "../types";

const result = (data: unknown): ToolResult<unknown> => ({ ok: true, data, source: "fake", fetchedAt: "2026-10-24T06:00:00Z" });

test("regression (chat): a market cap in the wrong unit is corrected against get_financials", () => {
  const fetched = new Map([["get_financials:{}", result({ marketCap: 9150000000000, marketCapDisplay: "₹9.15 L Cr", pe: 17.64 })]]);
  const warnings: string[] = [];
  const answer = checkAnswer("TCS has a market cap of ₹91,500 Cr and a P/E of 17.64.", fetched, warnings);
  assert.equal(answer, "TCS has a market cap of ₹9.15 L Cr and a P/E of 17.64.");
  assert.equal(warnings.length, 1);
});

test("regression (chat): 'Should I buy' answers that cite unfetched Nifty averages get a visible note", () => {
  const fetched = new Map([["get_financials:{}", result({ pe: 17.64, dividendYield: 4.43 })]]);
  const warnings: string[] = [];
  const answer = checkAnswer("- Dividend yield of 4.4 % is above the Nifty average (~3.5 %).", fetched, warnings);
  assert.match(answer, /unverified/);
  assert.equal(warnings.length, 1);
});

test("answers without tool data (concept explanations) aren't checked", () => {
  const warnings: string[] = [];
  const text = "A P/E of 20 vs a sector average of 15 would look expensive (illustrative).";
  assert.equal(checkAnswer(text, new Map(), warnings), text);
  assert.deepEqual(warnings, []);
});

test("the chat instructions forbid unfetched comparison figures and converted market caps", () => {
  assert.match(AGENT_SYSTEM_PROMPT, /an index's or sector's P\/E, an "average" dividend yield/);
  assert.match(AGENT_SYSTEM_PROMPT, /marketCapDisplay, exactly as given/);
});

test("regression: the data summary shown when the AI service stops part-way carries the disclaimer", async () => {
  const { summariseGathered } = await import("../orchestrator");
  const summary = summariseGathered(new Map([["get_price:{}", result({ symbol: "TCS", price: 2530, currency: "INR", changePercent: 0.92 })]]));
  assert.match(summary ?? "", /TCS: 2530 INR[\s\S]*not investment advice/);
});
