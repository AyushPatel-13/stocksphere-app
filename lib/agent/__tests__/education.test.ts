import { test } from "node:test";
import assert from "node:assert/strict";

import { LLMError } from "../errors";
import { AGENT_SYSTEM_PROMPT } from "../llm/prompts";
import { NO_DATA_NOTE, runAgent, withFailureNote } from "../orchestrator";
import { isConceptQuestion, toolsFor } from "../routing";
import type { LLMCompletionResult, LLMMessage, ToolDefinition } from "../types";

/**
 * Regressions for "what is F&O ban in Indian market?" being refused as if
 * StockSphere had "no data entry defining F&O ban": general education
 * questions get the glossary path, time-sensitive ones the full tool set, and
 * a failed lookup is reported as missing data, never as an unknown concept.
 */

const answer = (content: string): LLMCompletionResult => ({ content, toolCalls: null });
const names = (tools: ToolDefinition[]) => tools.map((t) => t.name).sort();

test("concept questions are recognised; time-sensitive and company questions aren't", () => {
  for (const q of [
    "What is F&O ban in the Indian market?",
    "what is F&O ban in Indian market?",
    "What is the P/E ratio?",
    "Explain SIP vs lump sum",
    "How does T+1 settlement work?",
    "What does EV/EBITDA mean?",
    '[Context: user is viewing TCS; "this stock"/"this company" means TCS.] What is the F&O ban?',
  ]) {
    assert.equal(isConceptQuestion(q), true, q);
  }
  for (const q of [
    "Why did NIFTY fall today?",
    "Which stocks are currently in the F&O ban list?",
    "Is SAIL in the F&O ban today?",
    "What is the P/E of Infosys?",
    "What is TCS's P/E?",
    "What is the price of TCS?",
    "What is RELIANCE trading at?",
    "Research Reliance Industries",
  ]) {
    assert.equal(isConceptQuestion(q), false, q);
  }
});

test("regression: 'What is F&O ban in the Indian market?' is offered only the glossary and app guide", async () => {
  const offered: string[][] = [];
  let call = 0;
  const result = await runAgent(
    { message: "What is F&O ban in the Indian market?" },
    {
      getChatCompletion: async (_messages, tools) => {
        offered.push(names(tools));
        call += 1;
        // The model sends the term in its own words; it must still resolve.
        if (call === 1) return { content: null, toolCalls: [{ id: "t1", name: "get_market_term", arguments: '{"term":"F&O ban"}' }] };
        return answer("An F&O ban stops fresh derivative positions in a stock once open interest passes 95% of its MWPL.");
      },
    }
  );
  assert.deepEqual(offered[0], ["get_app_help", "get_market_term"]);
  assert.deepEqual(result.toolCalls.map((c) => [c.tool, c.ok]), [["get_market_term", true]]);
  assert.match(result.answer, /95%/);
});

test("regression: 'What is the P/E ratio?' needs no live tools", () => {
  assert.deepEqual(names(toolsFor("What is the P/E ratio?")), ["get_app_help", "get_market_term"]);
});

test("regression: 'Why did NIFTY fall today?' gets the index and movers tools, and is told not to use news for an index", () => {
  const offered = names(toolsFor("Why did NIFTY fall today?"));
  assert.ok(offered.includes("get_market_quotes") && offered.includes("get_market_movers"));
  assert.match(AGENT_SYSTEM_PROMPT, /never get_news with an index name/);
});

test("regression: 'Which stocks are currently in the F&O ban list?' gets the NSE ban-list tool", () => {
  assert.ok(names(toolsFor("Which stocks are currently in the F&O ban list?")).includes("get_fo_ban_list"));
  assert.match(AGENT_SYSTEM_PROMPT, /get_fo_ban_list; name only the securities it returns, with its trade date/);
});

test("a concept question can't be sent to the news service: the call is refused with an explanation", async () => {
  let toolMessage = "";
  let call = 0;
  const result = await runAgent(
    { message: "What is the F&O ban?" },
    {
      getChatCompletion: async (messages: LLMMessage[]) => {
        call += 1;
        if (call === 1) return { content: null, toolCalls: [{ id: "n1", name: "get_news", arguments: '{"symbol":"F&O"}' }] };
        toolMessage = String(messages.find((m) => m.role === "tool")?.content);
        return answer("Explained from general knowledge.");
      },
    }
  );
  assert.match(toolMessage, /isn't available for this question\. It says nothing about the topic/);
  assert.equal(result.toolCalls[0].ok, false);
});

test("regression: invalid tool arguments reach the model as a request error, not as 'no such concept'", async () => {
  let toolMessage = "";
  let call = 0;
  await runAgent(
    { message: "Latest news on banks right now?" },
    {
      getChatCompletion: async (messages: LLMMessage[]) => {
        call += 1;
        if (call === 1) return { content: null, toolCalls: [{ id: "b1", name: "get_news", arguments: '{"limit":3}' }] };
        toolMessage = String(messages.find((m) => m.role === "tool")?.content);
        return answer("ok");
      },
    }
  );
  assert.match(toolMessage, /request error, not missing information about the topic/);
});

test("regression: unavailable data is labelled as missing data, never as an unknown concept", () => {
  const failed = withFailureNote({ ok: false, data: null, source: "NSE F&O ban list", fetchedAt: "x" });
  assert.equal((failed as unknown as { note: string }).note, NO_DATA_NOTE);
  assert.match(NO_DATA_NOTE, /missing data, not evidence that a concept doesn't exist/);
  assert.match(AGENT_SYSTEM_PROMPT, /A tool error or empty result means data was unavailable, never that a concept doesn't exist/);
  // Successful results pass through untouched.
  const fine = { ok: true, data: { a: 1 }, source: "s", fetchedAt: "x" };
  assert.equal(withFailureNote(fine), fine);
});

test("regression: a provider timeout on a concept question fails honestly instead of inventing an answer", async () => {
  await assert.rejects(
    runAgent({ message: "What is the P/E ratio?" }, { getChatCompletion: async () => { throw new LLMError("The AI service didn't respond. Please try again shortly."); } }),
    (error: unknown) => error instanceof LLMError
  );
});

test("a bare company name ('what is tcs') isn't a concept question: it keeps the company tools", () => {
  assert.equal(isConceptQuestion("what is tcs"), false);
  assert.equal(isConceptQuestion("What is Reliance?"), false);
  assert.ok(names(toolsFor("what is tcs")).includes("resolve_symbol"));
});

test("regression: an index-move question isn't offered the news tool (it only takes stock symbols)", () => {
  const offered = names(toolsFor("Why did NIFTY fall today?"));
  assert.ok(!offered.includes("get_news"));
  assert.ok(names(toolsFor("Why did TCS fall today?")).includes("get_news"));
});

test("regression: 'today' on a weekend must be described as the latest session with its date", () => {
  assert.match(AGENT_SYSTEM_PROMPT, /if the user says "today" but the figures' as-of date is an earlier session/);
});
