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
const noModel = { getChatCompletion: async (): Promise<LLMCompletionResult> => { throw new Error("no model call expected"); } };
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

test("regression: 'What is F&O ban in the Indian market?' is explained without a model call, and offered only F&O tools", async () => {
  assert.deepEqual(names(toolsFor("What is F&O ban in the Indian market?")), ["get_app_help", "get_fo_ban_list", "get_market_term"]);
  const result = await runAgent({ message: "What is F&O ban in the Indian market?" }, noModel);
  assert.match(result.answer, /95%/);
  assert.deepEqual(result.toolCalls, []);
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
    { message: "What is the P/E ratio?" },
    {
      getChatCompletion: async (messages: LLMMessage[]) => {
        call += 1;
        if (call === 1) return { content: null, toolCalls: [{ id: "n1", name: "get_news", arguments: '{"symbol":"PE"}' }] };
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

// --- "no data in StockSphere resources" for the F&O ban ------------------------

const NSE_BAN_PAGE = "https://www.nseindia.com/static/products-services/equity-derivatives-risk-management-sec-ban";
const REFUSAL = "I'm sorry, but I don't have any data on Fand O ban in the StockSphere resources.";

test("regression: F&O ban phrasings without 'what is' still get the concept path, not news", () => {
  for (const q of ["F&O ban", "tell me about F&O ban", "f&o ban in indian market", "Why is a stock put in F&O ban?", "F and O ban kya hai", "FnO ban rules"]) {
    assert.deepEqual(names(toolsFor(q)), ["get_app_help", "get_fo_ban_list", "get_market_term"], q);
  }
  for (const q of ["Which stocks are in the F&O ban today?", "current F&O ban list", "Is SAIL in the F&O ban?"]) {
    assert.ok(names(toolsFor(q)).includes("get_fo_ban_list"), q);
  }
});

test("regression: 'What is F and O ban?' never reaches a model that could refuse it as 'no data'", async () => {
  const result = await runAgent({ message: "What is F and O ban?" }, { getChatCompletion: async () => answer(REFUSAL) });
  assert.doesNotMatch(result.answer, /don't have any data/);
  assert.match(result.answer, /General information/);
  assert.match(result.answer, /95% of its market-wide position limit/);
  assert.doesNotMatch(result.answer, /get_fo_ban_list/);
  assert.equal(result.links?.[0]?.href, NSE_BAN_PAGE);
  assert.equal(result.links?.[0]?.label, "Check Today's NSE F&O Ban List");
});

test("regression: an F&O ban question is still explained, with the NSE link, when the AI service is down", async () => {
  const result = await runAgent({ message: "tell me about F&O ban" }, {
    getChatCompletion: async () => { throw new LLMError("The AI service didn't respond. Please try again shortly."); },
  });
  assert.match(result.answer, /95% of its market-wide position limit/);
  assert.equal(result.links?.[0]?.href, NSE_BAN_PAGE);
});

test("other glossary concepts: a model's 'no data' refusal is replaced by the glossary entry", async () => {
  const result = await runAgent({ message: "What is a circuit limit?" }, { getChatCompletion: async () => answer("Sorry, I don't have any data on circuit limits in StockSphere.") });
  assert.match(result.answer, /General information/);
  assert.match(result.answer, /daily price band/);
});

test("a real explanation from the model is kept, not replaced by the glossary", async () => {
  const explanation = "**General information** — a circuit limit is the daily price band a stock can't trade beyond.";
  const result = await runAgent({ message: "What is a circuit limit?" }, { getChatCompletion: async () => answer(explanation) });
  assert.equal(result.answer, explanation);
});

test("'Which stocks are in the F&O ban today?' with NSE unreachable: no list is invented, the ban is explained, NSE is linked", async () => {
  const result = await runAgent({ message: "Which stocks are in the F&O ban today?" }, { ...noModel, foBanList: async () => null });
  assert.match(result.answer, /couldn't fetch NSE's ban-period file/);
  assert.match(result.answer, /95% of its market-wide position limit/);
  assert.doesNotMatch(result.answer, /\| Security \|/);
  assert.equal(result.links?.[0]?.href, NSE_BAN_PAGE);
  assert.ok(result.warnings.some((w) => /couldn't be fetched/.test(w)));
});
