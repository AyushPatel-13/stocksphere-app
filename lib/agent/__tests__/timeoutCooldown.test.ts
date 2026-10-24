import { test } from "node:test";
import assert from "node:assert/strict";

import { LONG_ANSWER_TIMEOUT_MS, PROVIDER_TIMEOUT_MS, TIMEOUT_COOLDOWN_MS, getChatCompletion, orderForAttempt, type ChainDeps } from "../llm/client";
import { ProviderError, type LLMProvider } from "../llm/providers/types";

function provider(id: string, outcome: () => Promise<{ content: string; toolCalls: null }>): LLMProvider & { calls: number } {
  const p = {
    id,
    provider: id.split(":")[0],
    calls: 0,
    async complete() {
      p.calls += 1;
      return { ...(await outcome()), servedBy: id };
    },
  };
  return p;
}

test("a provider that times out is skipped by the next requests for a while", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    let now = 1_000_000;
    const slow = provider("gemini:m", async () => {
      throw new ProviderError("gemini:m", null, "timed out after 20000 ms");
    });
    const fast = provider("groq:m", async () => ({ content: "ok", toolCalls: null }));
    const deps: ChainDeps = { providers: [slow, fast], now: () => now, cooldowns: new Map(), sleep: async () => {} };

    assert.equal((await getChatCompletion([], [], {}, deps)).content, "ok");
    assert.equal(deps.cooldowns.get("gemini:m"), 1_000_000 + TIMEOUT_COOLDOWN_MS);

    now += 1000;
    assert.deepEqual(orderForAttempt(deps.providers, deps.cooldowns, now).map((p) => p.id), ["groq:m", "gemini:m"]);
    await getChatCompletion([], [], {}, deps);
    assert.equal(slow.calls, 1, "the slow provider wasn't tried again during its cooldown");
  } finally {
    console.error = original;
  }
});

test("regression: a long research write-up gets 35 s per provider call; ordinary calls keep 20 s", async () => {
  const timeouts: number[] = [];
  const recorder: LLMProvider = {
    id: "groq:m",
    provider: "groq",
    async complete(_messages, _tools, options) {
      timeouts.push(options.timeoutMs);
      return { content: "ok", toolCalls: null, servedBy: "groq:m" };
    },
  };
  const deps: ChainDeps = { providers: [recorder], now: () => 0, cooldowns: new Map(), sleep: async () => {} };

  await getChatCompletion([], [], { longAnswer: true, deadline: 45_000 }, deps);
  await getChatCompletion([], [], {}, deps);
  // Never beyond the request's own deadline.
  await getChatCompletion([], [], { longAnswer: true, deadline: 30_000 }, deps);
  assert.deepEqual(timeouts, [LONG_ANSWER_TIMEOUT_MS, PROVIDER_TIMEOUT_MS, 30_000]);
  assert.equal(LONG_ANSWER_TIMEOUT_MS, 35_000);
});
