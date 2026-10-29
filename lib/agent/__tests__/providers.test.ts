import { test } from "node:test";
import assert from "node:assert/strict";

import { buildProviders, providerOrder } from "../llm/providers/registry";
import { getChatCompletion, orderForAttempt, type ChainDeps } from "../llm/client";
import { ProviderError, type LLMProvider } from "../llm/providers/types";
import { chatCompletionsProvider, toWireMessages, fromWireResponse } from "../llm/providers/chatCompletions";
import { toResponsesInput, fromResponsesOutput } from "../llm/providers/responses";
import { toAnthropicMessages, fromAnthropicMessage } from "../llm/providers/anthropic";
import { runAgent, executeWithTimeout } from "../orchestrator";
import { AGENT_SYSTEM_PROMPT } from "../llm/prompts";
import { GLOSSARY } from "../tools/glossaryTool";
import { LLMError } from "../errors";
import type { LLMCompletionResult, LLMMessage } from "../types";
import type Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------- registry

test("registry: free providers first; with only GROQ_API_KEY it runs on Groq alone", () => {
  assert.deepEqual(buildProviders({ GROQ_API_KEY: "g" }).map((p) => p.id), ["groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b"]);
  assert.deepEqual(
    buildProviders({ GROQ_API_KEY: "g", GEMINI_API_KEY: "m", GROQ_FALLBACK_MODEL: "none" }).map((p) => p.id),
    ["gemini:gemini-3.5-flash-lite", "groq:openai/gpt-oss-120b"],
    "Gemini first, Groq as its fallback"
  );
});

test("registry: paid providers only with their keys; LLM_PROVIDERS sets the order; ids never carry keys", () => {
  const env = { GEMINI_API_KEY: "secret-m", GROQ_API_KEY: "secret-g", GROQ_FALLBACK_MODEL: "none", ANTHROPIC_API_KEY: "secret-a", OPENROUTER_API_KEY: "secret-o" };
  assert.deepEqual(buildProviders(env).map((p) => p.provider), ["gemini", "groq", "openrouter", "anthropic"]);
  const ordered = buildProviders({ ...env, LLM_PROVIDERS: "groq, anthropic,bogus,groq" });
  assert.deepEqual(ordered.map((p) => p.provider), ["groq", "anthropic"]);
  assert.ok(ordered.every((p) => !p.id.includes("secret")));
  assert.deepEqual(providerOrder({ LLM_PROVIDERS: "" }), ["gemini", "groq", "openrouter", "anthropic", "openai", "xai"]);
  assert.deepEqual(buildProviders({}), []);
});

// ---------------------------------------------------------------- chain

function fakeProvider(id: string, outcomes: (LLMCompletionResult | ProviderError)[]): LLMProvider & { calls: number } {
  const p = {
    id,
    provider: id.split(":")[0],
    calls: 0,
    async complete() {
      const outcome = outcomes[Math.min(p.calls, outcomes.length - 1)];
      p.calls += 1;
      if (outcome instanceof ProviderError) throw outcome;
      return { ...outcome, servedBy: id };
    },
  };
  return p;
}

function chain(providers: LLMProvider[], t = { now: 1_000_000 }): ChainDeps & { slept: number[] } {
  const slept: number[] = [];
  return { providers, now: () => t.now, cooldowns: new Map(), sleep: async (ms) => { slept.push(ms); t.now += ms; }, slept };
}

const answer = (content: string): LLMCompletionResult => ({ content, toolCalls: null });
const quiet = <T>(fn: () => Promise<T>) => {
  const original = console.error;
  console.error = () => {};
  return fn().finally(() => { console.error = original; });
};

test("chain: a rate-limited or timed-out provider falls through to the next, which answers", async () => {
  const gemini = fakeProvider("gemini:m", [new ProviderError("gemini:m", 429, "quota", 30)]);
  const groq = fakeProvider("groq:m", [answer("from groq")]);
  const deps = chain([gemini, groq]);
  const result = await quiet(() => getChatCompletion([], [], {}, deps));
  assert.equal(result.content, "from groq");
  assert.equal(result.servedBy, "groq:m");
  assert.equal(deps.cooldowns.get("gemini:m"), 1_000_000 + 30_000, "skipped for the retry-after it asked for");
  // While cooling down, the healthy provider is tried first.
  assert.deepEqual(orderForAttempt([gemini, groq], deps.cooldowns, 1_000_001).map((p) => p.id), ["groq:m", "gemini:m"]);

  const slow = fakeProvider("a:m", [new ProviderError("a:m", null, "timed out after 20000 ms")]);
  const ok = fakeProvider("b:m", [answer("ok")]);
  assert.equal((await quiet(() => getChatCompletion([], [], {}, chain([slow, ok])))).content, "ok");
});

test("chain: when every provider is rate-limited it waits once (bounded) and retries", async () => {
  const groq = fakeProvider("groq:m", [new ProviderError("groq:m", 429, "tpm", 2), answer("after wait")]);
  const deps = chain([groq]);
  const result = await quiet(() => getChatCompletion([], [], {}, deps));
  assert.equal(result.content, "after wait");
  assert.deepEqual(deps.slept, [2000]);
});

test("chain: no provider is started past the deadline, and failures read as friendly errors", async () => {
  const groq = fakeProvider("groq:m", [answer("late")]);
  const deps = chain([groq]);
  await quiet(() => assert.rejects(getChatCompletion([], [], { deadline: 1_000_000 + 1000 }, deps), LLMError));
  assert.equal(groq.calls, 0);
  await assert.rejects(getChatCompletion([], [], {}, chain([])), /No AI provider is configured/);
  const bad = fakeProvider("x:m", [new ProviderError("x:m", 401, "bad key org_123")]);
  await quiet(() => assert.rejects(getChatCompletion([], [], {}, chain([bad])), (e: Error) => /configured correctly/.test(e.message) && !/org_/.test(e.message)));
});

// ---------------------------------------------------------------- wire formats

const toolTurn: LLMMessage = { role: "assistant", content: null, toolCalls: [{ id: "c1", name: "get_ipos", arguments: '{"name":"hd fire"}' }] };

test("chat completions: request shape, and Gemini's thought signatures are replayed only to Gemini", async () => {
  let sent: { url: string; init: RequestInit } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent = { url, init };
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, reasoning: "hidden", tool_calls: [{ id: "c1", type: "function", function: { name: "get_ipos", arguments: '{"name":"hd fire"}' }, extra_content: { google: { thought_signature: "sig" } } }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const provider = chatCompletionsProvider({ provider: "gemini", model: "gemini-3.8-flash", baseUrl: "https://example.test/v1beta/openai", apiKey: "k", fetchImpl });
  const result = await provider.complete([{ role: "user", content: "hi" }], [{ name: "get_ipos", description: "d", parameters: { type: "object", properties: {} }, argsSchema: null as never, execute: null as never }], { toolChoice: "auto", timeoutMs: 1000, maxOutputTokens: 100 });

  assert.equal(sent!.url, "https://example.test/v1beta/openai/chat/completions");
  const body = JSON.parse(String(sent!.init.body));
  assert.equal(body.model, "gemini-3.8-flash");
  assert.equal(body.tool_choice, "auto");
  assert.equal(body.tools[0].function.name, "get_ipos");
  assert.equal("temperature" in body, false, "Gemini keeps its default temperature");
  assert.equal((sent!.init.headers as Record<string, string>).authorization, "Bearer k");

  assert.deepEqual(result.toolCalls, [{ id: "c1", name: "get_ipos", arguments: '{"name":"hd fire"}' }]);
  const turn: LLMMessage = { ...toolTurn, raw: result.raw };
  const replayed = toWireMessages("gemini", [turn])[0];
  assert.equal(JSON.stringify(replayed).includes("thought_signature"), true);
  assert.equal(JSON.stringify(replayed).includes("hidden"), false, "reasoning text isn't sent back");
  assert.equal(JSON.stringify(toWireMessages("groq", [turn])[0]).includes("thought_signature"), false);
  assert.throws(() => fromWireResponse("groq", { choices: [] }), ProviderError);
});

test("responses API: instructions, call outputs, and reasoning items replayed to the same provider", () => {
  const output = [
    { type: "reasoning", id: "rs_1", summary: [] },
    { type: "function_call", id: "fc_1", call_id: "call_1", name: "get_ipos", arguments: "{}" },
  ];
  const parsed = fromResponsesOutput("openai", { output });
  assert.deepEqual(parsed.toolCalls, [{ id: "call_1", name: "get_ipos", arguments: "{}" }]);

  const messages: LLMMessage[] = [
    { role: "system", content: "rules" },
    { role: "user", content: "q" },
    { ...toolTurn, toolCalls: parsed.toolCalls!, raw: parsed.raw },
    { role: "tool", toolCallId: "call_1", content: '{"ok":true}' },
  ];
  const same = toResponsesInput("openai", messages);
  assert.equal(same.instructions, "rules");
  assert.deepEqual(same.input[1], output[0], "the reasoning item goes back with the call");
  assert.deepEqual(same.input.at(-1), { type: "function_call_output", call_id: "call_1", output: '{"ok":true}' });
  const other = toResponsesInput("xai", messages);
  assert.deepEqual(other.input[1], { type: "function_call", call_id: "call_1", name: "get_ipos", arguments: "{}" });

  const text = fromResponsesOutput("openai", { output: [{ type: "message", content: [{ type: "output_text", text: "Hello" }] }] });
  assert.equal(text.content, "Hello");
});

test("anthropic: one user turn per round of tool results; later instructions ride on it; refusals fall through", () => {
  const { system, messages } = toAnthropicMessages("anthropic", [
    { role: "system", content: "rules" },
    { role: "user", content: "q" },
    { role: "assistant", content: null, toolCalls: [{ id: "t1", name: "a", arguments: "{}" }, { id: "t2", name: "b", arguments: '{"x":1}' }] },
    { role: "tool", toolCallId: "t1", content: "r1" },
    { role: "tool", toolCallId: "t2", content: "r2" },
    { role: "system", content: "answer now" },
  ]);
  assert.equal(system, "rules");
  assert.equal(messages.length, 3);
  const last = messages[2];
  assert.equal(last.role, "user");
  assert.deepEqual((last.content as { type: string }[]).map((b) => b.type), ["tool_result", "tool_result", "text"]);
  assert.deepEqual((messages[1].content as { type: string; input?: unknown }[])[1], { type: "tool_use", id: "t2", name: "b", input: { x: 1 } });

  const message = { content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "tool_use", id: "t9", name: "get_ipos", input: { name: "jio" } }], stop_reason: "tool_use" } as unknown as Anthropic.Beta.BetaMessage;
  const parsed = fromAnthropicMessage("anthropic", message);
  assert.deepEqual(parsed.toolCalls, [{ id: "t9", name: "get_ipos", arguments: '{"name":"jio"}' }]);
  assert.equal((parsed.raw!.data as unknown[]).length, 2, "thinking block kept for replay");
  assert.throws(() => fromAnthropicMessage("anthropic", { content: [], stop_reason: "refusal" } as unknown as Anthropic.Beta.BetaMessage), ProviderError);
});

// ---------------------------------------------------------------- orchestrator

test("runAgent: an empty reply is asked again once, without tools, instead of returning the fallback", async () => {
  const calls: { toolChoice?: string; last: string }[] = [];
  const result = await runAgent({ message: "Should i invest in hd fire ipo ?" }, {
    getChatCompletion: async (messages, _tools, options) => {
      calls.push({ toolChoice: options?.toolChoice, last: messages.at(-1)?.content ?? "" });
      return calls.length === 1 ? { content: "", toolCalls: null } : answer("HD Fire Protect listed on 21 Oct… This is general information, not investment advice.");
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].toolChoice, "none");
  assert.match(calls[1].last, /last reply was empty/);
  assert.match(result.answer, /not investment advice/);
});

test("runAgent: every model call carries a deadline, and the final answer gets the reserve", async () => {
  const deadlines: (number | undefined)[] = [];
  let call = 0;
  await runAgent({ message: "Jio financials" }, {
    now: () => 0,
    deadlineMs: 50_000,
    getChatCompletion: async (_m, _t, options) => {
      deadlines.push(options?.deadline);
      call += 1;
      return call === 1 ? { content: null, toolCalls: [{ id: "c", name: "get_app_help", arguments: "{}" }] } : answer("done");
    },
  });
  assert.deepEqual(deadlines, [38_000, 38_000]);
});

test("runAgent: the provider's raw turn is kept on the assistant message for replay", async () => {
  let second: LLMMessage[] = [];
  let call = 0;
  const result = await runAgent({ message: "price of x" }, {
    toolTimeoutMs: 20,
    getChatCompletion: async (messages) => {
      call += 1;
      if (call === 1) return { content: null, toolCalls: [{ id: "c", name: "get_market_term", arguments: '{"term":"fo_ban"}' }], raw: { provider: "gemini", data: { sig: 1 } } };
      second = messages;
      return answer("ok");
    },
  });
  assert.equal(result.answer, "ok");
  assert.deepEqual(second.find((m) => m.role === "assistant")?.raw, { provider: "gemini", data: { sig: 1 } });
});

// ---------------------------------------------------------------- production regressions (Oct 2026)

test("regression: F&O ban is explained from the glossary with the 95%/80% MWPL rules", () => {
  assert.match(GLOSSARY.fo_ban, /95% of its market-wide position limit/);
  assert.match(GLOSSARY.fo_ban, /below 80% of MWPL/);
  assert.match(GLOSSARY.fo_ban, /may only reduce or close/);
  assert.match(AGENT_SYSTEM_PROMPT, /never refuse because StockSphere has no data on them/);
  assert.match(AGENT_SYSTEM_PROMPT, /call it first/);
});

test("regression: 'should I invest in <IPO>' fetches the IPO facts instead of refusing", () => {
  assert.match(AGENT_SYSTEM_PROMPT, /never reply with only a refusal or an offer to look things up/);
  assert.match(AGENT_SYSTEM_PROMPT, /an IPO: get_ipos details/);
  assert.match(AGENT_SYSTEM_PROMPT, /Anything about an IPO .* → get_ipos with the name first/);
});

test("regression: an obvious match from context is used rather than asking", () => {
  assert.match(AGENT_SYSTEM_PROMPT, /"Jio financials" after discussing Jio → JIOFIN\.NS/);
});

test("executeWithTimeout: a data source that hangs comes back as unavailable", async () => {
  const hung = await executeWithTimeout(() => new Promise(() => {}), "get_news", 20);
  assert.deepEqual([hung.ok, hung.data, hung.source], [false, null, "get_news"]);
  const fine = await executeWithTimeout(async () => ({ ok: true, data: 1, source: "s", fetchedAt: "" }), "s", 1000);
  assert.equal(fine.ok, true);
});

test("chain: with one provider it keeps waiting out rate limits while the deadline allows", async () => {
  const groq = fakeProvider("groq:m", [new ProviderError("groq:m", 429, "tpm", 10), new ProviderError("groq:m", 429, "tpm", 10), answer("third time")]);
  const deps = chain([groq]);
  const result = await quiet(() => getChatCompletion([], [], { deadline: 1_000_000 + 45_000 }, deps));
  assert.equal(result.content, "third time");
  assert.deepEqual(deps.slept, [10_000, 10_000]);

  const tight = fakeProvider("groq:m", [new ProviderError("groq:m", 429, "tpm", 10)]);
  const tightDeps = chain([tight]);
  await quiet(() => assert.rejects(getChatCompletion([], [], { deadline: 1_000_000 + 8_000 }, tightDeps), /busy/));
  assert.deepEqual(tightDeps.slept, [], "no wait that would overrun the deadline");
});

test("chain: a spent daily quota fails fast with an honest message instead of waiting", async () => {
  const body = '{"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` in organization `org_abc123` on tokens per day (TPD): Limit 200000"}}';
  const fetchImpl = (async () => new Response(body, { status: 429, headers: { "retry-after": "40" } })) as unknown as typeof fetch;
  const groq = chatCompletionsProvider({ provider: "groq", model: "m", baseUrl: "https://example.test", apiKey: "k", fetchImpl });
  const deps = chain([groq]);
  const error = await quiet(() => getChatCompletion([], [], { deadline: 1_000_000 + 45_000 }, deps).then(() => null, (e: Error) => e));
  assert.match(error!.message, /free AI quota for today/);
  assert.deepEqual(deps.slept, [], "no waiting on a daily limit");
  assert.equal(deps.cooldowns.get("groq:m"), 1_000_000 + 15 * 60_000);
});

test("chain: Gemini overloaded (503) while Groq cools down → a short wait and a retry, not an error", async () => {
  const gemini = fakeProvider("gemini:m", [new ProviderError("gemini:m", 503, "This model is currently experiencing high demand"), answer("after overload")]);
  const groq = fakeProvider("groq:m", [new ProviderError("groq:m", 429, "tpm", 20)]);
  const deps = chain([gemini, groq]);
  const result = await quiet(() => getChatCompletion([], [], { deadline: 1_000_000 + 45_000 }, deps));
  assert.equal(result.content, "after overload");
  assert.deepEqual(deps.slept, [4_000]);
});
