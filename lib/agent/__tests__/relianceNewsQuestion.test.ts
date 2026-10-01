// UPSTOX_ACCESS_TOKEN is assigned on the first executable line, before anything
// that reads it is loaded: lib/apis/upstox.ts and lib/apis/upstoxNews.ts read
// the token into a module-level const at import time, so a value set afterwards
// is ignored and every Upstox call throws. Nothing here is imported statically
// except node builtins — the orchestrator is imported dynamically inside each
// test, after the assignment has run.
process.env.UPSTOX_ACCESS_TOKEN = "test-token-not-a-real-secret";

import { test } from "node:test";
import assert from "node:assert/strict";

import type { LLMMessage, LLMCompletionResult, ToolDefinition } from "../types";

/**
 * "Show me recent news about Reliance." — the question the Agent answered by
 * asking for an exact ticker.
 *
 * The resolver was the cause, and only for names the registry spells out in
 * full. Upstox stores "Reliance Industries Ltd.", so "Reliance" never equals a
 * stored name, and Reliance Power / Reliance Industrial Infrastructure /
 * Reliance Chemotex all share the first word: the top of the list read as four
 * equally likely companies. These tests run the real tool-calling loop over the
 * real registry with realistic Upstox rows, so they fail if the resolver stops
 * putting RELIANCE first for the name a person would use.
 */

interface RecordedCall {
  messages: LLMMessage[];
  toolChoice: string;
}

function scriptedLLM(script: LLMCompletionResult[]) {
  const calls: RecordedCall[] = [];

  const getChatCompletion = async (
    messages: LLMMessage[],
    _tools: ToolDefinition[],
    options?: { toolChoice?: "auto" | "none" }
  ): Promise<LLMCompletionResult> => {
    calls.push({ messages: [...messages], toolChoice: options?.toolChoice ?? "auto" });

    const result = script[calls.length - 1];
    if (!result) {
      throw new Error(`scriptedLLM was called more times than scripted (call ${calls.length})`);
    }

    return result;
  };

  return { getChatCompletion, calls };
}

function toolCall(id: string, name: string, args: Record<string, unknown>): LLMCompletionResult {
  return { content: null, toolCalls: [{ id, name, arguments: JSON.stringify(args) }] };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** The JSON the model was given by the last tool that ran. */
function lastToolPayload(call: RecordedCall): { ok: boolean; data: unknown } {
  const toolMessages = call.messages.filter((message) => message.role === "tool");
  return JSON.parse(toolMessages[toolMessages.length - 1].content ?? "null");
}

const MAX_STEPS_WARNING = "maximum number of tool-calling steps";

// --- The stubbed Upstox chain -------------------------------------------------

const RELIANCE_KEY = "NSE_EQ|INE002A01018";

function instrumentRow(tradingSymbol: string, name: string, key: string) {
  return {
    segment: "NSE_EQ",
    instrument_type: "EQ",
    trading_symbol: tradingSymbol,
    name,
    instrument_key: key,
    isin: `ISIN_${tradingSymbol}`,
    exchange: "NSE",
  };
}

// The real registry spellings, in the order Upstox happens to return them: the
// company actually asked for is last.
const RELIANCE_ROWS = [
  instrumentRow("RPOWER", "Reliance Power Ltd.", "NSE_EQ|KEY_RPOWER"),
  instrumentRow("RIIL", "Reliance Industrial Infrastructure Ltd.", "NSE_EQ|KEY_RIIL"),
  instrumentRow("RELCHEMQ", "Reliance Chemotex Industries Ltd.", "NSE_EQ|KEY_RELCHEMQ"),
  instrumentRow("RELIANCE", "Reliance Industries Ltd.", RELIANCE_KEY),
];

const HEADLINE = "Reliance Industries reports quarterly results";

const NEWS_ROW = {
  heading: HEADLINE,
  summary: "Reliance Industries Ltd. announced its results for the quarter.",
  article_link: "https://example.in/reliance-results",
  // Upstox publishes this feed in unix milliseconds; an article the adapter
  // cannot date is dropped rather than shown undated.
  published_time: 1790063368434,
  thumbnail: "",
};

/** Search resolves the Reliance family; the news call returns one article. */
function upstoxChain(news: () => Response): { fetch: typeof fetch; newsUrls: string[] } {
  const newsUrls: string[] = [];

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes("/instruments/search")) {
      const query = new URL(url).searchParams.get("query") ?? "";
      const rows = RELIANCE_ROWS.filter((row) =>
        `${row.trading_symbol} ${row.name}`.toLowerCase().includes(query.toLowerCase())
      );

      return jsonResponse({ data: rows });
    }

    if (url.includes("/news?")) {
      newsUrls.push(url);
      return news();
    }

    throw new Error(`unexpected fetch in this test: ${url}`);
  }) as typeof fetch;

  return { fetch: fetchImpl, newsUrls };
}

async function withFetch<T>(replacement: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = replacement;

  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

// --- The regression -----------------------------------------------------------

test("'Show me recent news about Reliance.' resolves Reliance and fetches its news", async () => {
  // Upstox's documented news envelope is { status: "success", data: { <key>: [...] } };
  // anything else is read as "cannot tell whether there is news".
  const chain = upstoxChain(() =>
    jsonResponse({ status: "success", data: { [RELIANCE_KEY]: [NEWS_ROW] } })
  );

  await withFetch(chain.fetch, async () => {
    const { runAgent } = await import("../orchestrator");
    const { getChatCompletion, calls } = scriptedLLM([
      toolCall("t1", "resolve_symbol", { query: "Reliance" }),
      toolCall("t2", "get_news", { symbol: "RELIANCE.NS" }),
      { content: "Reliance Industries' recent coverage includes ...", toolCalls: null },
    ]);

    const result = await runAgent(
      { message: "Show me recent news about Reliance." },
      { getChatCompletion }
    );

    // 1. The resolver ran and put the company the user named at the top — with
    //    three other Reliance-named companies in the same result set.
    const resolution = lastToolPayload(calls[1]);
    assert.equal(result.toolCalls[0].tool, "resolve_symbol");
    const candidates = (resolution.data as { candidates: { symbol: string; name: string }[] })
      .candidates;
    assert.equal(candidates[0].symbol, "RELIANCE.NS");
    assert.equal(candidates[0].name, "Reliance Industries Ltd.");
    assert.ok(candidates.length > 1, "the ambiguity is real; it is the ordering that resolves it");

    // 2. News was then fetched for that symbol, from the news feed itself.
    assert.equal(result.toolCalls[1].tool, "get_news");
    assert.deepEqual(result.toolCalls[1].input, { symbol: "RELIANCE.NS" });
    assert.equal(result.toolCalls[1].ok, true);
    assert.equal(chain.newsUrls.length, 1);
    assert.ok(
      chain.newsUrls[0].includes(encodeURIComponent(RELIANCE_KEY)),
      `news must be asked for the resolved instrument, got ${chain.newsUrls[0]}`
    );

    // 3. The real headline reached the model, and the source is visible.
    const news = lastToolPayload(calls[2]);
    assert.deepEqual((news.data as { headline: string }[]).map((a) => a.headline), [HEADLINE]);
    assert.ok(result.sources.some((source) => source.includes("News")));

    // 4. It answered for itself, inside the step budget.
    assert.equal(result.answer, "Reliance Industries' recent coverage includes ...");
    assert.ok(
      !result.warnings.some((warning) => warning.includes(MAX_STEPS_WARNING)),
      "two tool calls are nowhere near the budget"
    );
  });
});

test("when the news feed is unavailable the Agent is told so rather than given an empty feed", async () => {
  const chain = upstoxChain(() => jsonResponse({ status: "error" }, 500));

  await withFetch(chain.fetch, async () => {
    const { runAgent } = await import("../orchestrator");
    const { getChatCompletion, calls } = scriptedLLM([
      toolCall("t1", "resolve_symbol", { query: "Reliance" }),
      toolCall("t2", "get_news", { symbol: "RELIANCE.NS" }),
      { content: "News for Reliance is currently unavailable.", toolCalls: null },
    ]);

    const result = await runAgent(
      { message: "Show me recent news about Reliance." },
      { getChatCompletion }
    );

    assert.equal(result.toolCalls[1].ok, false);
    assert.equal(lastToolPayload(calls[2]).data, null);
  });
});
