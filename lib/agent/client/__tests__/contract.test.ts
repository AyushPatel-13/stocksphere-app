import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_LENGTH,
  buildHistory,
  buildStockContext,
  composeMessage,
  maxQuestionLength,
  truncate,
} from "@/lib/agent/client/contract";

// ---------------------------------------------------------------------------
// Stock context
// ---------------------------------------------------------------------------

test("no stock page means no context line", () => {
  assert.equal(buildStockContext(undefined), "");
  assert.equal(buildStockContext(null), "");
  assert.equal(buildStockContext(""), "");
  assert.equal(buildStockContext("   "), "");
});

test("the context line names the symbol and resolves pronouns to it", () => {
  const context = buildStockContext("TCS");

  assert.match(context, /TCS/);
  assert.match(context, /this company/i);
  assert.match(context, /this stock/i);
});

test("context is not a tool instruction — it states the page, not the lookup", () => {
  const context = buildStockContext("TCS.NS");

  // Naming a tool would pre-empt the agent's own resolution step.
  assert.doesNotMatch(context, /resolve_symbol/);
  assert.doesNotMatch(context, /call |use the tool/i);
});

// ---------------------------------------------------------------------------
// composeMessage
// ---------------------------------------------------------------------------

test("a question on a stock page carries the context line", () => {
  const wire = composeMessage("What is the current price?", "TCS");

  assert.ok(wire.startsWith("[Context:"));
  assert.match(wire, /TCS/);
  assert.ok(wire.endsWith("What is the current price?"));
});

test("a question with no context is sent as typed", () => {
  assert.equal(composeMessage("  Hello  ", null), "Hello");
});

test("the composed message always fits the server's limit", () => {
  const long = "a".repeat(4000);

  for (const symbol of [null, "TCS", "RELIANCE.NS", "A-VERY-LONG-SYMBOL.BSE"]) {
    const wire = composeMessage(long, symbol);

    assert.ok(
      wire.length <= MAX_MESSAGE_LENGTH,
      `${symbol}: composed ${wire.length} chars`
    );
  }
});

test("the composed message keeps the whole question when it fits", () => {
  const question = "How has TCS performed recently?";
  const wire = composeMessage(question, "TCS");

  assert.ok(wire.includes(question));
  assert.ok(wire.length <= MAX_MESSAGE_LENGTH);
});

test("maxQuestionLength is exactly what fits alongside the context", () => {
  for (const symbol of [null, "TCS", "RELIANCE.NS"]) {
    const limit = maxQuestionLength(symbol);
    const wire = composeMessage("x".repeat(limit + 50), symbol);

    assert.ok(limit > 0);
    assert.ok(wire.length <= MAX_MESSAGE_LENGTH);
  }
});

test("maxQuestionLength never goes to zero or negative", () => {
  assert.ok(maxQuestionLength("A".repeat(2000)) >= 1);
});

// ---------------------------------------------------------------------------
// buildHistory
// ---------------------------------------------------------------------------

test("history is capped at the server's maximum, keeping the newest turns", () => {
  const turns = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `turn-${index}`,
  }));

  const history = buildHistory(turns);

  assert.equal(history.length, MAX_HISTORY_MESSAGES);
  assert.equal(history[history.length - 1].content, "turn-39");
  assert.equal(history[0].content, `turn-${40 - MAX_HISTORY_MESSAGES}`);
});

test("an oversized assistant answer is trimmed rather than failing the request", () => {
  // A single entry over the per-message limit makes the route reject the whole
  // request, which would strand the conversation.
  const history = buildHistory([
    { role: "assistant", content: "y".repeat(5000) },
  ]);

  assert.equal(history.length, 1);
  assert.ok(history[0].content.length <= MAX_MESSAGE_LENGTH);
  assert.equal(history[0].role, "assistant");
});

test("history preserves order and roles", () => {
  const history = buildHistory([
    { role: "user", content: "one" },
    { role: "assistant", content: "two" },
    { role: "user", content: "three" },
  ]);

  assert.deepEqual(history, [
    { role: "user", content: "one" },
    { role: "assistant", content: "two" },
    { role: "user", content: "three" },
  ]);
});

test("an empty transcript produces no history", () => {
  assert.deepEqual(buildHistory([]), []);
});

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------

test("truncate leaves short values untouched and marks the cut", () => {
  assert.equal(truncate("abc", 10), "abc");

  const cut = truncate("abcdefghij", 5);

  assert.equal(cut.length, 5);
  assert.ok(cut.endsWith("…"));
  assert.equal(cut, "abcd…");
});

test("truncate never exceeds the requested length", () => {
  for (const max of [0, 1, 2, 3, 10]) {
    assert.ok(truncate("abcdefghijklmno", max).length <= max);
  }
});
