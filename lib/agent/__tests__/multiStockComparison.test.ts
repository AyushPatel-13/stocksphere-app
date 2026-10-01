import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../orchestrator";
import type { LLMMessage, LLMCompletionResult, ToolDefinition } from "../types";

// ---------------------------------------------------------------------------
// "Compare TCS and Infosys."
//
// Live, this question exhausted the tool-calling budget and answered "I wasn't
// able to finish gathering the data needed to answer that" while holding nine
// real tool results. The trace showed why: the model asked for ONE tool per
// turn — resolve TCS, resolve Infosys, company TCS, company Infosys, price TCS
// — so a cap of five *turns* bought exactly five tool calls, and a two-stock
// comparison needs about ten.
//
// These tests pin the loop's behaviour on that shape of question. They are
// deliberately network-free: the symbol resolver falls back to its built-in
// list, and the one test that needs a real quote stubs globalThis.fetch, which
// is the same convention the market and provider tests already use.
// ---------------------------------------------------------------------------

interface RecordedCall {
  messages: LLMMessage[];
  toolChoice: string;
}

/**
 * A scripted LLM that also records what it was asked.
 *
 * Termination alone proves very little: a loop can stop while the model never
 * actually saw the second company's data. Recording the messages lets the
 * tests assert that the tool results reached the model, and with which
 * tool_choice each turn was requested.
 */
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
  return {
    content: null,
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
  };
}

/** Everything the model has been told by tools, as one searchable string. */
function toolResultsSeen(call: RecordedCall): string {
  return call.messages
    .filter((message) => message.role === "tool")
    .map((message) => message.content ?? "")
    .join("\n");
}

function toolCallIdsIn(call: RecordedCall): string[] {
  return call.messages
    .filter((message) => message.role === "tool")
    .map((message) => message.toolCallId ?? "");
}

const MAX_STEPS_WARNING = "maximum number of tool-calling steps";

const TWO_STOCKS = ["TCS.NS", "INFY.NS"];

test("a two-stock comparison completes when the model asks for independent tools together", async () => {
  // The flow the system prompt now asks for: both resolutions in one turn, then
  // the same metrics for both symbols in the next.
  const { getChatCompletion, calls } = scriptedLLM([
    {
      content: null,
      toolCalls: [
        { id: "r1", name: "resolve_symbol", arguments: JSON.stringify({ query: "TCS" }) },
        { id: "r2", name: "resolve_symbol", arguments: JSON.stringify({ query: "Infosys" }) },
      ],
    },
    {
      content: null,
      toolCalls: TWO_STOCKS.flatMap((symbol, index) => [
        { id: `p${index}`, name: "get_price", arguments: JSON.stringify({ symbol }) },
        { id: `c${index}`, name: "get_company", arguments: JSON.stringify({ symbol }) },
        { id: `f${index}`, name: "get_financials", arguments: JSON.stringify({ symbol }) },
      ]),
    },
    { content: "TCS and Infosys, compared metric by metric.", toolCalls: null },
  ]);

  const result = await runAgent(
    { message: "Compare TCS and Infosys." },
    { getChatCompletion }
  );

  // 1. Terminates, and produces the model's own answer rather than a fallback.
  assert.equal(result.answer, "TCS and Infosys, compared metric by metric.");
  assert.equal(calls.length, 3, "two tool rounds plus the answer, well inside the budget");

  // Nothing is claimed about the cap, and the only warnings are the honest
  // per-tool ones: this test environment has no market-data credentials, so the
  // metric tools really do come back empty, and the agent says so per symbol
  // rather than inventing a comparison — which is the required behaviour when
  // some data is unavailable.
  assert.ok(
    !result.warnings.some((warning) => warning.includes(MAX_STEPS_WARNING)),
    "the budget was not exhausted"
  );
  assert.ok(result.warnings.length > 0);
  assert.ok(
    result.warnings.every((warning) => warning.startsWith("No data was available from")),
    `only unavailability warnings, got: ${JSON.stringify(result.warnings)}`
  );

  // 2. Both symbols resolved, really: resolve_symbol executed and returned the
  //    canonical .NS symbols, which is the form the other tools are given.
  const resolutions = result.toolCalls.filter((entry) => entry.tool === "resolve_symbol");
  assert.equal(resolutions.length, 2);
  assert.ok(resolutions.every((entry) => entry.ok), "both stocks resolved");
  assert.ok(toolResultsSeen(calls[2]).includes("TCS.NS"));
  assert.ok(toolResultsSeen(calls[2]).includes("INFY.NS"));

  // 3. Every required tool executed, and each result was fed back to the model.
  assert.equal(result.toolCalls.length, 8);
  for (const name of ["resolve_symbol", "get_price", "get_company", "get_financials"]) {
    assert.ok(
      result.toolCalls.some((entry) => entry.tool === name),
      `${name} ran`
    );
  }
  assert.equal(toolCallIdsIn(calls[2]).length, 8, "every tool_call id got a tool message");
});

test("the reported one-tool-per-turn flow answers instead of failing when the budget runs out", async () => {
  // The exact shape observed live, extended to a full comparison: one tool per
  // turn, so the eight rounds are eight calls and the ninth turn is the
  // reserved answer.
  const { getChatCompletion, calls } = scriptedLLM([
    toolCall("1", "resolve_symbol", { query: "TCS" }),
    toolCall("2", "resolve_symbol", { query: "Infosys" }),
    toolCall("3", "get_company", { symbol: "TCS.NS" }),
    toolCall("4", "get_company", { symbol: "INFY.NS" }),
    toolCall("5", "get_price", { symbol: "TCS.NS" }),
    toolCall("6", "get_price", { symbol: "INFY.NS" }),
    toolCall("7", "get_financials", { symbol: "TCS.NS" }),
    toolCall("8", "get_financials", { symbol: "INFY.NS" }),
    { content: "Compared using the data that was available.", toolCalls: null },
  ]);

  const result = await runAgent(
    { message: "Compare TCS and Infosys." },
    { getChatCompletion }
  );

  // The regression itself: this is the case that used to return
  // "I wasn't able to finish gathering the data needed to answer that."
  assert.equal(result.answer, "Compared using the data that was available.");
  assert.ok(
    !result.warnings.some((warning) => warning.includes(MAX_STEPS_WARNING)),
    "the user is not told the agent ran out of steps when it answered"
  );
  assert.doesNotMatch(result.answer, /wasn't able to finish/);

  // The last turn withholds tools, so the model has to answer from the
  // conversation rather than reaching for another lookup.
  assert.equal(calls.length, 9);
  assert.equal(calls[8].toolChoice, "none");

  // Both companies' data was in front of it when it answered.
  const finalResults = toolResultsSeen(calls[8]);
  for (const symbol of TWO_STOCKS) {
    assert.ok(finalResults.includes(symbol), `${symbol} reached the final answer turn`);
  }
});

test("the failure fallback is still reachable when the reserved answer turn yields nothing", async () => {
  // The cap must still degrade honestly rather than loop: eight unproductive
  // rounds, and a final turn that produces no prose.
  const rounds = Array.from({ length: 8 }, (_, index) =>
    toolCall(`x${index}`, "resolve_symbol", { query: `unrelated-${index}` })
  );

  const { getChatCompletion, calls } = scriptedLLM([
    ...rounds,
    { content: "   ", toolCalls: null },
  ]);

  const result = await runAgent({ message: "hi" }, { getChatCompletion });

  assert.match(result.answer, /wasn't able to finish/);
  assert.ok(result.warnings.some((warning) => warning.includes(MAX_STEPS_WARNING)));
  assert.equal(calls.length, 9, "the loop terminated instead of calling the model forever");
});

test("an identical tool call is answered from the first result rather than re-fetched", async () => {
  const { getChatCompletion, calls } = scriptedLLM([
    {
      content: null,
      toolCalls: [
        { id: "a", name: "resolve_symbol", arguments: JSON.stringify({ query: "TCS" }) },
        { id: "b", name: "resolve_symbol", arguments: JSON.stringify({ query: "TCS" }) },
      ],
    },
    { content: "Done.", toolCalls: null },
  ]);

  const result = await runAgent({ message: "what is tcs" }, { getChatCompletion });

  // One fetch, so one chip in the UI and one round's worth of work.
  assert.equal(result.toolCalls.length, 1);

  // But the conversation stays valid: every tool_call id is still answered, or
  // the provider rejects the next request outright.
  assert.deepEqual(toolCallIdsIn(calls[1]), ["a", "b"]);
  const [first, second] = calls[1].messages
    .filter((message) => message.role === "tool")
    .map((message) => message.content);
  assert.equal(first, second, "the repeat is given the original result");
});

test("a real price tool result reaches the model through the tool loop", async () => {
  // The other tests script the loop; this one proves a data tool genuinely
  // executes inside it and that its value is what the model is shown.
  const realFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (!url.includes("twelvedata.com")) {
      throw new TypeError(`unexpected fetch to ${url}`);
    }

    return new Response(
      JSON.stringify({
        symbol: "AAPL",
        close: "150.2",
        previous_close: "149.0",
        currency: "USD",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const { getChatCompletion, calls } = scriptedLLM([
      toolCall("1", "resolve_symbol", { query: "Apple" }),
      toolCall("2", "get_price", { symbol: "AAPL" }),
      { content: "AAPL is 150.2.", toolCalls: null },
    ]);

    const result = await runAgent(
      { message: "What is Apple's price?" },
      { getChatCompletion }
    );

    assert.equal(result.answer, "AAPL is 150.2.");

    const price = result.toolCalls.find((entry) => entry.tool === "get_price");
    assert.equal(price?.ok, true, "the price tool returned real data");
    assert.ok(toolResultsSeen(calls[2]).includes("150.2"), "the price reached the model");
    assert.ok(result.sources.includes("StockSphere Market Quote Service"));
  } finally {
    globalThis.fetch = realFetch;
  }
});
