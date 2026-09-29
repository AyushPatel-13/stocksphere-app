import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../orchestrator";
import type { LLMCompletionResult } from "../types";

function fakeLLM(script: LLMCompletionResult[]) {
  let call = 0;
  return async () => {
    const result = script[call];
    call += 1;
    if (!result) {
      throw new Error("fakeLLM called more times than scripted");
    }
    return result;
  };
}

test("runAgent returns the LLM's direct answer when it calls no tools", async () => {
  const getChatCompletion = fakeLLM([{ content: "Hello!", toolCalls: null }]);

  const result = await runAgent({ message: "hi" }, { getChatCompletion });

  assert.equal(result.answer, "Hello!");
  assert.deepEqual(result.toolCalls, []);
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.warnings, []);
});

test("runAgent executes a requested tool and feeds the result back for a final answer", async () => {
  const getChatCompletion = fakeLLM([
    {
      content: null,
      toolCalls: [
        { id: "call_1", name: "resolve_symbol", arguments: JSON.stringify({ query: "tcs" }) },
      ],
    },
    { content: "TCS likely refers to Tata Consultancy Services.", toolCalls: null },
  ]);

  const result = await runAgent({ message: "what is tcs" }, { getChatCompletion });

  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].tool, "resolve_symbol");
  assert.equal(result.toolCalls[0].ok, true);
  assert.equal(result.sources.length, 1);
  assert.equal(result.answer, "TCS likely refers to Tata Consultancy Services.");
});

test("runAgent records a warning and a failed trace entry for an unknown tool name", async () => {
  const getChatCompletion = fakeLLM([
    { content: null, toolCalls: [{ id: "call_1", name: "not_a_real_tool", arguments: "{}" }] },
    { content: "Done.", toolCalls: null },
  ]);

  const result = await runAgent({ message: "hi" }, { getChatCompletion });

  assert.equal(result.toolCalls[0].ok, false);
  assert.ok(result.warnings.some((w) => w.includes("unknown tool")));
});

test("runAgent records a warning for invalid tool arguments instead of throwing", async () => {
  const getChatCompletion = fakeLLM([
    {
      content: null,
      // resolve_symbol requires a non-empty `query` string.
      toolCalls: [{ id: "call_1", name: "resolve_symbol", arguments: JSON.stringify({}) }],
    },
    { content: "Done.", toolCalls: null },
  ]);

  const result = await runAgent({ message: "hi" }, { getChatCompletion });

  assert.equal(result.toolCalls[0].ok, false);
  assert.ok(result.warnings.some((w) => w.includes("Invalid arguments")));
});

test("runAgent stops after the iteration cap and returns a graceful fallback", async () => {
  const infiniteToolCall: LLMCompletionResult = {
    content: null,
    toolCalls: [
      { id: "call_x", name: "resolve_symbol", arguments: JSON.stringify({ query: "a" }) },
    ],
  };
  const getChatCompletion = fakeLLM(Array(5).fill(infiniteToolCall));

  const result = await runAgent({ message: "hi" }, { getChatCompletion });

  assert.equal(result.toolCalls.length, 5);
  assert.ok(result.warnings.some((w) => w.includes("maximum number of tool-calling steps")));
  assert.match(result.answer, /wasn't able to finish/);
});

test("runAgent passes through a caller-supplied conversationId", async () => {
  const getChatCompletion = fakeLLM([{ content: "ok", toolCalls: null }]);

  const result = await runAgent(
    { message: "hi", conversationId: "my-id-123" },
    { getChatCompletion }
  );

  assert.equal(result.conversationId, "my-id-123");
});
