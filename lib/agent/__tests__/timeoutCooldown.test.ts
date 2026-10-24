import { test } from "node:test";
import assert from "node:assert/strict";

import { TIMEOUT_COOLDOWN_MS, getChatCompletion, orderForAttempt, type ChainDeps } from "../llm/client";
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
