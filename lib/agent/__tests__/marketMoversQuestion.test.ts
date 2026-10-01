// UPSTOX_ACCESS_TOKEN is assigned on the first executable line, before anything
// that reads it is loaded: lib/apis/upstox.ts reads the token into a
// module-level const at import time, so a value set afterwards is ignored and
// every instrument search throws. The static imports below deliberately touch
// only the instrument list; ../orchestrator, which pulls in the whole tool
// registry and therefore Upstox, is imported dynamically inside each test.
process.env.UPSTOX_ACCESS_TOKEN = "test-token-not-a-real-secret";

import { test } from "node:test";
import assert from "node:assert/strict";

import { NIFTY_50_SYMBOLS } from "@/lib/data/instruments/india";
import type { LLMMessage, LLMCompletionResult, ToolDefinition } from "../types";

/**
 * "top 5 stocks today" — the question the Agent answered with "I'm not able to
 * pull a ranked list of the day's biggest movers automatically", because it had
 * no ranking tool rather than because the data was missing.
 *
 * These tests run the real tool-calling loop over the real tool registry and
 * stub only globalThis.fetch, the same arrangement app/api/market/__tests__ and
 * lib/providers/__tests__ already use. What they prove is that the ranked data
 * reaches the model for this question, and that when the provider is down the
 * model is handed a failure and no ranking at all.
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

/** The JSON the model was given by the last tool that ran. */
function lastToolPayload(call: RecordedCall): {
  ok: boolean;
  data: { universe: string; gainers: { symbol: string }[]; losers: { symbol: string }[] } | null;
} {
  const toolMessages = call.messages.filter((message) => message.role === "tool");
  return JSON.parse(toolMessages[toolMessages.length - 1].content ?? "null");
}

const MAX_STEPS_WARNING = "maximum number of tool-calling steps";

// --- The stubbed Upstox chain -------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const PREV_CLOSE = 100;

// The universe's own length decides the midpoint, so the ranking asserted below
// is stated in terms of the list rather than pinned to today's constituents.
const MID = Math.floor(NIFTY_50_SYMBOLS.length / 2);
const changeFor = (index: number) => index - MID;

const TOP_GAINERS = [...NIFTY_50_SYMBOLS].reverse().slice(0, 5);
const TOP_LOSERS = NIFTY_50_SYMBOLS.slice(0, 5);

/** One row per Nifty 50 symbol; the last gains the most, the first falls most. */
function bulkQuotes(): Response {
  const data: Record<string, unknown> = {};

  NIFTY_50_SYMBOLS.forEach((symbol, index) => {
    const change = changeFor(index);

    data[`NSE_EQ:${symbol}`] = {
      instrument_token: `NSE_EQ|${symbol}`,
      symbol,
      last_price: PREV_CLOSE + change,
      prev_close_price: PREV_CLOSE,
      net_change: change,
      volume: 1_000,
      ohlc: { open: PREV_CLOSE, high: PREV_CLOSE + 1, low: PREV_CLOSE - 1 },
    };
  });

  return jsonResponse({ data });
}

/** Instrument search resolves every symbol; the bulk quote call decides the case. */
function upstoxChain(quotes: () => Response): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes("/instruments/search")) {
      const query = new URL(url).searchParams.get("query") ?? "";

      return jsonResponse({
        data: [
          {
            segment: "NSE_EQ",
            instrument_type: "EQ",
            trading_symbol: query,
            instrument_key: `NSE_EQ|${query}`,
          },
        ],
      });
    }

    return quotes();
  }) as typeof fetch;
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

test("'top 5 stocks today' is answered from real Nifty 50 movers", async () => {
  await withFetch(upstoxChain(bulkQuotes), async () => {
    const { runAgent } = await import("../orchestrator");
    const { getChatCompletion, calls } = scriptedLLM([
      toolCall("m1", "get_market_movers", { limit: 5 }),
      { content: "Nifty 50's biggest gainers today were ...", toolCalls: null },
    ]);

    const result = await runAgent({ message: "top 5 stocks today" }, { getChatCompletion });

    // 1. The tool exists, ran, and succeeded — the capability that was missing.
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].tool, "get_market_movers");
    assert.equal(result.toolCalls[0].ok, true);
    assert.deepEqual(result.toolCalls[0].input, { limit: 5 });
    assert.ok(
      result.sources.some((source) => source.includes("Market Movers")),
      `expected a movers source, got ${JSON.stringify(result.sources)}`
    );

    // 2. The ranking the model was handed is the one computed from the quotes,
    //    in order — no ranking is produced anywhere but here.
    const payload = lastToolPayload(calls[1]);
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.data?.gainers.map((mover) => mover.symbol), TOP_GAINERS);
    assert.deepEqual(payload.data?.losers.map((mover) => mover.symbol), TOP_LOSERS);

    // 3. The universe is named, because the answer has to say where the ranking
    //    came from.
    assert.ok(payload.data?.universe.includes("Nifty 50"));

    // 4. The model answered for itself, and was not told the budget ran out.
    assert.equal(result.answer, "Nifty 50's biggest gainers today were ...");
    assert.ok(
      !result.warnings.some((warning) => warning.includes(MAX_STEPS_WARNING)),
      "one tool call is nowhere near the budget"
    );
  });
});

test("an unavailable provider is reported honestly instead of becoming a ranking", async () => {
  await withFetch(upstoxChain(() => jsonResponse({ status: "error" }, 500)), async () => {
    const { runAgent } = await import("../orchestrator");
    const { getChatCompletion, calls } = scriptedLLM([
      toolCall("m1", "get_market_movers", {}),
      { content: "The Nifty 50 market data is currently unavailable.", toolCalls: null },
    ]);

    const result = await runAgent({ message: "top 5 stocks today" }, { getChatCompletion });

    // The tool failed rather than answering with two empty lists, which would
    // have read as "nothing moved today".
    assert.equal(result.toolCalls[0].ok, false);
    assert.ok(result.warnings.some((warning) => warning.startsWith("No data was available from")));

    // No source is claimed, and the model is handed the failure — the same fact
    // the required answer is built on.
    const payload = lastToolPayload(calls[1]);
    assert.equal(payload.ok, false);
    assert.equal(payload.data, null);
    assert.ok(result.sources.length === 0, "a failed lookup must not claim a source");
  });
});
