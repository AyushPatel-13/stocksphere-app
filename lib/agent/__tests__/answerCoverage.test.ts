import { test } from "node:test";
import assert from "node:assert/strict";

import { runAgent, serialiseForModel, MAX_TOOL_RESULT_CHARS } from "../orchestrator";
import { AGENT_SYSTEM_PROMPT, dateContext } from "../llm/prompts";
import { fallbackModel, shouldFallBack, toLLMError } from "../llm/client";
import { LLMError } from "../errors";
import { getEnrichedFinancials, type EnrichDeps } from "../tools/financialsTool";
import { periodReturn } from "../tools/performanceTool";
import { createSymbolResolverTool } from "../tools/symbolResolverTool";
import { okResult, type LLMCompletionResult, type LLMMessage } from "../types";

// Regression cover for the question types the assistant used to refuse or
// fail: concepts, app how-to, off-topic, advice, indices/crypto/ETF/bond/IPO
// routing, oversized tool results (Groq 413) and provider failures mid-run.

test("prompt: concepts are answered from general knowledge, labelled, not refused", () => {
  assert.doesNotMatch(AGENT_SYSTEM_PROMPT, /answer from StockSphere's data tools only/);
  assert.match(AGENT_SYSTEM_PROMPT, /general knowledge, under a "General information" label/);
  assert.match(AGENT_SYSTEM_PROMPT, /Off-topic requests/);
  assert.match(AGENT_SYSTEM_PROMPT, /This is general information, not investment advice\./);
});

test("prompt: live data stays tool-only, and every new data area has a route", () => {
  assert.match(AGENT_SYSTEM_PROMPT, /never figures from memory/);
  assert.match(AGENT_SYSTEM_PROMPT, /never invent a reason for a move/);
  for (const tool of ["get_market_quotes", "get_ipos", "get_app_help", "get_performance", "get_financials", "get_news", "resolve_symbol"]) {
    assert.match(AGENT_SYSTEM_PROMPT, new RegExp(tool), tool);
  }
  assert.match(AGENT_SYSTEM_PROMPT, /"IT stocks" → NIFTYIT/);
  assert.match(AGENT_SYSTEM_PROMPT, /fix obvious misspellings/);
  assert.match(AGENT_SYSTEM_PROMPT, /In a follow-up/);
});

test("prompt: the date line is in India time", () => {
  assert.equal(dateContext(new Date("2026-10-20T20:00:00Z")), "Today is Wednesday, 21 October 2026 (India time).");
});

test("runAgent: the system prompt carries today's date", async () => {
  let seen: LLMMessage[] = [];
  await runAgent({ message: "What is a P/E ratio?" }, {
    getChatCompletion: async (messages) => {
      seen = messages;
      return { content: "General information: …", toolCalls: null };
    },
    now: () => Date.parse("2026-10-21T05:00:00Z"),
  });
  assert.match(seen[0].content ?? "", /Today is Wednesday, 21 October 2026/);
});

test("serialiseForModel: a long history is cut to the newest entries and says so", () => {
  const points = Array.from({ length: 500 }, (_, i) => ({ date: `2026-01-${String(i).padStart(3, "0")}`, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1000 + i }));
  const json = serialiseForModel(okResult({ symbol: "NIFTYBEES.NS", points }, "test"));
  assert.ok(json.length <= MAX_TOOL_RESULT_CHARS, `${json.length}`);
  const parsed = JSON.parse(json);
  assert.equal(parsed.data.symbol, "NIFTYBEES.NS");
  assert.equal(parsed.data.points.at(-1).volume, 1499, "the newest point is kept");
  assert.match(parsed.data.truncated, /Only the last \d+ of 500 entries/);
});

test("serialiseForModel: small results pass through unchanged", () => {
  const result = okResult({ price: 1220.9 }, "test");
  assert.equal(serialiseForModel(result), JSON.stringify(result));
});

test("runAgent: a provider failure after data was gathered returns that data, not an error", async () => {
  let call = 0;
  const result = await runAgent({ message: "Price of Bitcoin and the 10-year yield" }, {
    getChatCompletion: async (): Promise<LLMCompletionResult> => {
      call += 1;
      if (call === 1) return { content: null, toolCalls: [{ id: "c1", name: "calculate", arguments: JSON.stringify({ operation: "percent_change", values: [100, 110] }) }] };
      throw new LLMError("The AI service is busy right now. Please try again in a minute.");
    },
  });
  assert.match(result.answer, /percent change of 100 → 110: 10%/);
  assert.ok(result.warnings.some((w) => /stopped responding/.test(w)));
});

test("runAgent: a provider failure before any data still surfaces as an error", async () => {
  await assert.rejects(
    runAgent({ message: "hi" }, { getChatCompletion: async () => { throw new LLMError("busy"); } }),
    LLMError
  );
});

test("llm client: 413 (one request over the per-minute limit) falls back and reads clearly", () => {
  assert.equal(shouldFallBack({ status: 413 }), true);
  assert.equal(shouldFallBack({ status: 429 }), true);
  assert.equal(shouldFallBack({ status: 400 }), false);
  const original = console.error;
  console.error = () => {};
  try {
    assert.match(toLLMError({ status: 413 }).message, /fewer items or a shorter period/);
  } finally {
    console.error = original;
  }
  assert.equal(fallbackModel(undefined), "openai/gpt-oss-20b");
  assert.equal(fallbackModel("llama-3.3-70b-versatile"), "llama-3.3-70b-versatile");
  assert.equal(fallbackModel("none"), null);
});

test("financials: EPS reported in another currency than the price is left out, not mislabelled", async () => {
  const deps: EnrichDeps = {
    financials: async () => ({ pe: 15.12 }),
    quote: async () => ({ price: 1166.35, currency: "INR" }),
    yahooSymbol: () => "INFY.NS",
    fundamentals: async () => ({ epsTtm: { value: 0.81, asOf: "2026-06-30" }, sharesOutstanding: { value: 4049645811, asOf: "2026-06-30" }, currency: "USD" }),
    dividends: async () => null,
    range52w: async () => null,
  };
  const f = (await getEnrichedFinancials("INFY.NS", deps))!;
  assert.equal(f.eps, null);
  assert.equal(f.sources.eps, undefined);
  assert.equal(f.pe, 15.12, "the provider's P/E is kept");
  assert.equal(f.currency, "INR");
  assert.ok(f.marketCap !== null, "shares outstanding don't depend on currency");
});


test("performance: 'this year' (ytd) starts from last year's final close, not 12 months back", () => {
  const at = (iso: string, c: number) => ({ t: Date.parse(iso), o: c, h: c, l: c, c, v: 1 });
  const candles = [at("2025-10-21T10:00:00Z", 290), at("2025-12-31T10:00:00Z", 280), at("2026-01-02T10:00:00Z", 282), at("2026-10-21T10:00:00Z", 266)];
  const r = periodReturn(candles, "ytd")!;
  assert.equal(r.startDate, "2025-12-31");
  assert.equal(r.startClose, 280);
  assert.equal(r.returnPct, -5);
});

test("resolver: a former company name returns the current listing and says so", async () => {
  const searched: string[] = [];
  const tool = createSymbolResolverTool(async (q) => {
    searched.push(q);
    return [];
  });
  const result = await tool.execute({ query: "Zomato" });
  // Answered from lib/search/renames.ts, the list the search box uses too.
  assert.deepEqual(searched, []);
  assert.equal(result.data!.bestMatch?.symbol, "ETERNAL.NS");
  assert.match(result.data!.note ?? "", /renamed Eternal/);
});

test("prompt: 'should I' answers open with facts, never a softened verdict", () => {
  assert.match(AGENT_SYSTEM_PROMPT, /not even softened \("can be considered", "looks attractive"\)/);
  assert.match(AGENT_SYSTEM_PROMPT, /open with the plain facts instead/);
});
