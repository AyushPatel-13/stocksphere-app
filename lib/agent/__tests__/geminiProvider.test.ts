import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";

import { buildProviders } from "../llm/providers/registry";
import { geminiProvider, toGeminiContents, fromGeminiResponse, toProviderError } from "../llm/providers/gemini";
import { getChatCompletion, type ChainDeps } from "../llm/client";
import { DAILY_QUOTA_COOLDOWN_SEC, ProviderError, type LLMProvider } from "../llm/providers/types";
import { LLMError } from "../errors";
import type { LLMCompletionResult, LLMMessage, ToolDefinition } from "../types";

// No test here reaches the network: the SDK's `models` client is replaced by a fake.

const tool: ToolDefinition = { name: "get_quote", description: "d", parameters: { type: "object", properties: { symbol: { type: "string" } } }, argsSchema: null as never, execute: null as never };
const callOptions = { toolChoice: "auto" as const, timeoutMs: 1000, maxOutputTokens: 100 };

function fakeModels(outcomes: (Partial<GenerateContentResponse> | Error)[]) {
  const sent: GenerateContentParameters[] = [];
  return {
    sent,
    async generateContent(params: GenerateContentParameters) {
      sent.push(params);
      const outcome = outcomes[Math.min(sent.length - 1, outcomes.length - 1)];
      if (outcome instanceof Error) throw outcome;
      return outcome as GenerateContentResponse;
    },
  };
}

const quiet = <T>(fn: () => Promise<T>) => {
  const original = console.error;
  console.error = () => {};
  return fn().finally(() => { console.error = original; });
};

// ---------------------------------------------------------------- selection

test("gemini registry: SDK provider only with GEMINI_API_KEY; model and transport overridable; Gemini first by default", () => {
  assert.deepEqual(buildProviders({ GROQ_API_KEY: "g", GROQ_FALLBACK_MODEL: "none" }).map((p) => p.provider), ["groq"], "missing key: Gemini is skipped");
  assert.deepEqual(buildProviders({ GEMINI_API_KEY: "" }), [], "an empty key counts as missing");
  assert.deepEqual(buildProviders({ GEMINI_API_KEY: "secret-m" }).map((p) => p.id), ["gemini:gemini-3.5-flash-lite"]);
  assert.deepEqual(buildProviders({ GEMINI_API_KEY: "m", GEMINI_MODEL: "gemini-3.8-flash" }).map((p) => p.id), ["gemini:gemini-3.8-flash"]);
  const both = { GEMINI_API_KEY: "secret-m", GROQ_API_KEY: "secret-g", GROQ_FALLBACK_MODEL: "none" };
  assert.deepEqual(buildProviders(both).map((p) => p.provider), ["gemini", "groq"]);
  assert.deepEqual(buildProviders({ ...both, LLM_PROVIDERS: "groq,gemini" }).map((p) => p.provider), ["groq", "gemini"]);
  assert.ok(buildProviders(both).every((p) => !p.id.includes("secret")));
});

test("gemini registry: GEMINI_TRANSPORT=openai keeps the OpenAI-compatible endpoint", async () => {
  const [provider] = buildProviders({ GEMINI_API_KEY: "m", GEMINI_TRANSPORT: "openai" });
  assert.equal(provider.id, "gemini:gemini-3.5-flash-lite");
  const original = globalThis.fetch;
  let url = "";
  globalThis.fetch = (async (u: string) => {
    url = u;
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  try {
    await provider.complete([{ role: "user", content: "hi" }], [], callOptions);
  } finally {
    globalThis.fetch = original;
  }
  assert.match(url, /generativelanguage\.googleapis\.com\/v1beta\/openai\/chat\/completions$/);
});

// ---------------------------------------------------------------- request / response

test("gemini: request carries system instruction, JSON-schema tools and tool mode; text answers come back", async () => {
  const models = fakeModels([{ candidates: [{ content: { role: "model", parts: [{ text: "thinking…", thought: true }, { text: "Reliance is up 2%." }] }, finishReason: "STOP" as never }] }]);
  const provider = geminiProvider({ model: "gemini-3.8-flash", apiKey: "k", client: models });
  const result = await provider.complete([{ role: "system", content: "rules" }, { role: "user", content: "q" }], [tool], callOptions);

  assert.equal(result.content, "Reliance is up 2%.", "thought text is left out");
  assert.equal(result.toolCalls, null);
  assert.equal(result.servedBy, "gemini:gemini-3.8-flash");
  const config = models.sent[0].config!;
  assert.equal(models.sent[0].model, "gemini-3.8-flash");
  assert.equal(config.systemInstruction, "rules");
  assert.equal(config.maxOutputTokens, 100);
  assert.ok(config.abortSignal instanceof AbortSignal);
  assert.deepEqual(config.tools, [{ functionDeclarations: [{ name: "get_quote", description: "d", parametersJsonSchema: tool.parameters }] }]);
  assert.equal(config.toolConfig?.functionCallingConfig?.mode, "AUTO");

  await provider.complete([{ role: "user", content: "q" }], [tool], { ...callOptions, toolChoice: "none" });
  assert.equal(models.sent[1].config!.toolConfig?.functionCallingConfig?.mode, "NONE");
  await provider.complete([{ role: "user", content: "q" }], [], callOptions);
  assert.equal("tools" in models.sent[2].config!, false, "no tools: neither tools nor toolConfig is sent");
});

test("gemini: function calls keep their thought signatures for replay to Gemini only", () => {
  const parts = [{ functionCall: { id: "fc1", name: "get_quote", args: { symbol: "RELIANCE" } }, thoughtSignature: "sig" }, { functionCall: { name: "get_news", args: {} } }];
  const parsed = fromGeminiResponse("gemini", { candidates: [{ content: { role: "model", parts } }] } as GenerateContentResponse);
  assert.deepEqual(parsed.toolCalls, [
    { id: "fc1", name: "get_quote", arguments: '{"symbol":"RELIANCE"}' },
    { id: "gemini_call_1", name: "get_news", arguments: "{}" },
  ]);

  const history: LLMMessage[] = [
    { role: "system", content: "rules" },
    { role: "user", content: "q" },
    { role: "assistant", content: null, toolCalls: parsed.toolCalls, raw: parsed.raw },
    { role: "tool", toolCallId: "fc1", content: '{"price":1}' },
    { role: "tool", toolCallId: "gemini_call_1", content: "[]" },
    { role: "system", content: "answer now" },
  ];
  const { systemInstruction, contents } = toGeminiContents("gemini", history);
  assert.equal(systemInstruction, "rules");
  assert.deepEqual(contents.map((c) => c.role), ["user", "model", "user"]);
  assert.equal(contents[1].parts![0].thoughtSignature, "sig", "the model turn goes back unchanged");
  assert.deepEqual(contents[2].parts, [
    { functionResponse: { id: "fc1", name: "get_quote", response: { result: '{"price":1}' } } },
    { functionResponse: { name: "get_news", response: { result: "[]" } } },
    { text: "answer now" },
  ], "all results of a round in one user turn; made-up ids aren't sent");
});

test("gemini: tool turns from another provider are replayed as text (they carry no signature)", () => {
  const { contents } = toGeminiContents("gemini", [
    { role: "user", content: "q" },
    { role: "assistant", content: null, toolCalls: [{ id: "call_0", name: "get_quote", arguments: '{"symbol":"TCS"}' }], raw: { provider: "groq", data: {} } },
    { role: "tool", toolCallId: "call_0", content: '{"price":2}' },
  ]);
  assert.equal(JSON.stringify(contents).includes("functionCall"), false);
  assert.deepEqual(contents[1].parts, [{ text: 'Called get_quote with {"symbol":"TCS"}' }]);
  assert.deepEqual(contents[2].parts, [{ text: 'Result of get_quote: {"price":2}' }]);
});

test("gemini: blocked or empty responses throw ProviderError so the chain falls through", () => {
  assert.throws(() => fromGeminiResponse("gemini", { promptFeedback: { blockReason: "SAFETY" } } as GenerateContentResponse), ProviderError);
  assert.throws(() => fromGeminiResponse("gemini", { candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] } as unknown as GenerateContentResponse), ProviderError);
  assert.throws(() => fromGeminiResponse("gemini", { candidates: [] } as unknown as GenerateContentResponse), ProviderError);
});

// ---------------------------------------------------------------- errors

const perMinute = JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for projects/123456789", details: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "34s" }] } });
const perDay = JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded", details: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }, { retryDelay: "12s" }] } });

test("gemini errors: retry delay, daily quota and redaction", () => {
  const minute = toProviderError("gemini:m", new ApiError({ message: perMinute, status: 429 }), "k-secret");
  assert.equal(minute.status, 429);
  assert.equal(minute.retryAfterSec, 34);
  assert.equal(minute.dailyQuota, false);
  assert.equal(minute.message.includes("123456789"), false, "project number stripped");

  const day = toProviderError("gemini:m", new ApiError({ message: perDay, status: 429 }), "k");
  assert.equal(day.dailyQuota, true);
  assert.equal(day.retryAfterSec, DAILY_QUOTA_COOLDOWN_SEC, "a spent daily quota is skipped for the long cooldown");

  const leaked = toProviderError("gemini:m", new ApiError({ message: '{"error":"bad key k-secret"}', status: 400 }), "k-secret");
  assert.equal(leaked.message.includes("k-secret"), false, "the key never reaches logs");
  assert.equal(leaked.retryAfterSec, null);
});

test("gemini errors: SDK ApiError becomes ProviderError; a hung call times out", async () => {
  const provider = geminiProvider({ model: "m", apiKey: "k", client: fakeModels([new ApiError({ message: perMinute, status: 429 })]) });
  await assert.rejects(provider.complete([{ role: "user", content: "q" }], [], callOptions), (e: unknown) => e instanceof ProviderError && e.status === 429 && e.retryAfterSec === 34);

  const hung = geminiProvider({
    model: "m",
    apiKey: "k",
    client: {
      generateContent: (params: GenerateContentParameters) =>
        new Promise<GenerateContentResponse>((_, reject) => params.config!.abortSignal!.addEventListener("abort", () => reject(new Error("aborted")))),
    },
  });
  await assert.rejects(hung.complete([{ role: "user", content: "q" }], [], { ...callOptions, timeoutMs: 20 }), (e: unknown) => e instanceof ProviderError && e.status === null && /timed out/.test(e.message));

  const unauthorized = geminiProvider({ model: "m", apiKey: "k", client: fakeModels([new ApiError({ message: "{}", status: 401 })]) });
  await assert.rejects(unauthorized.complete([{ role: "user", content: "q" }], [], callOptions), (e: unknown) => e instanceof ProviderError && e.status === 401);
});

// ---------------------------------------------------------------- chain

function chain(providers: LLMProvider[]): ChainDeps {
  let now = 1_000_000;
  return { providers, now: () => now, cooldowns: new Map(), sleep: async (ms) => { now += ms; } };
}

const groq = (outcome: LLMCompletionResult | ProviderError): LLMProvider => ({
  id: "groq:m",
  provider: "groq",
  async complete() {
    if (outcome instanceof ProviderError) throw outcome;
    return { ...outcome, servedBy: "groq:m" };
  },
});

test("gemini in the chain: a rate-limited Groq falls back to Gemini, and a failing Gemini back to Groq", async () => {
  const gemini = geminiProvider({ model: "m", apiKey: "k", client: fakeModels([{ candidates: [{ content: { role: "model", parts: [{ text: "from gemini" }] } }] }]) });
  const viaGemini = await quiet(() => getChatCompletion([{ role: "user", content: "q" }], [], {}, chain([groq(new ProviderError("groq:m", 429, "tpm", 30)), gemini])));
  assert.equal(viaGemini.servedBy, "gemini:m");

  const broken = geminiProvider({ model: "m", apiKey: "k", client: fakeModels([new ApiError({ message: "{}", status: 500 })]) });
  const viaGroq = await quiet(() => getChatCompletion([{ role: "user", content: "q" }], [], {}, chain([broken, groq({ content: "from groq", toolCalls: null })])));
  assert.equal(viaGroq.servedBy, "groq:m");
});

test("gemini in the chain: both on a daily quota fails fast with the honest message, without waiting", async () => {
  const gemini = geminiProvider({ model: "m", apiKey: "k", client: fakeModels([new ApiError({ message: perDay, status: 429 })]) });
  const daily = new ProviderError("groq:m", 429, "TPD", DAILY_QUOTA_COOLDOWN_SEC, true);
  const deps = chain([groq(daily), gemini]);
  const started = deps.now();
  await quiet(() => assert.rejects(getChatCompletion([{ role: "user", content: "q" }], [], {}, deps), (e: unknown) => e instanceof LLMError && /quota for today/.test(e.message)));
  assert.equal(deps.now(), started, "no rate-limit wait when the quota won't clear soon");
});
