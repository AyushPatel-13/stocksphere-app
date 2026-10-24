import { test } from "node:test";
import assert from "node:assert/strict";

import { FO_BAN_URL, type FoBanList } from "@/lib/apis/nseFoBan";
import { answerNavigation } from "../navigation";
import { runAgent } from "../orchestrator";
import { abbreviationTicker, foBanIntent, toolsFor } from "../routing";
import type { LLMCompletionResult, ToolDefinition, ToolResult } from "../types";

/**
 * Regressions for "f and o ban in stocks in india" being answered about Ford
 * (F) and Occidental (O): the phrase contains "stocks in", which made it a
 * current-data question with every tool on offer, and the model looked up F
 * and O as tickers. F&O ban questions now never see a company tool, are
 * answered from the glossary and NSE's file, and letters cut from "F and O"
 * are never looked up as tickers anywhere.
 */

const NSE_BAN_PAGE = "https://www.nseindia.com/static/products-services/equity-derivatives-risk-management-sec-ban";
const COMPANY_TOOLS = ["resolve_symbol", "get_company", "get_price", "get_financials", "get_news", "get_historical", "get_performance"];

const names = (tools: ToolDefinition[]) => tools.map((t) => t.name);
const noModel = { getChatCompletion: async (): Promise<LLMCompletionResult> => { throw new Error("no model call expected"); } };
const list = (tradeDate: string, securities: string[]) => async (): Promise<FoBanList> => ({ tradeDate, securities, sourceUrl: FO_BAN_URL });
// 24 Oct 2026, 11:00 IST.
const now = () => Date.parse("2026-10-24T05:30:00Z");

function assertNoCompanyLookups(result: { toolCalls: { tool: string }[] }) {
  for (const call of result.toolCalls) assert.ok(!COMPANY_TOOLS.includes(call.tool), `unexpected ${call.tool}`);
}

// --- intent ------------------------------------------------------------------

test("F&O ban questions are recognised however they're worded, and are never offered a company tool", () => {
  const cases: Array<[string, string]> = [
    ["what is f and o ban", "concept"],
    ["f and o ban in stocks in india", "list"],
    ["which stocks are in the F&O ban today?", "list"],
    ["What is MWPL?", "concept"],
    ["futures and options ban", "concept"],
    ["NSE ban list", "list"],
    ["stocks in ban period", "list"],
    ["banned F&O stocks", "list"],
    ["FnO ban meaning", "concept"],
    ["Is SAIL in the F&O ban?", "stock"],
  ];
  for (const [question, intent] of cases) {
    assert.equal(foBanIntent(question), intent, question);
    const offered = names(toolsFor(question));
    assert.ok(offered.includes("get_fo_ban_list"), question);
    for (const tool of COMPANY_TOOLS) assert.ok(!offered.includes(tool), `${question} offered ${tool}`);
  }
});

test("'Show me Ford stock' is not an F&O question: company tools stay, and F is a ticker there", () => {
  assert.equal(foBanIntent("Show me Ford stock"), null);
  assert.ok(names(toolsFor("Show me Ford stock")).includes("get_company"));
  assert.equal(abbreviationTicker("Show me Ford stock", { symbol: "F" }), null);
  assert.equal(abbreviationTicker("Compare Ford and Occidental", { symbols: ["F", "OXY"] }), null);
});

test("letters cut from F&O or P/E are recognised as abbreviations, not tickers", () => {
  assert.match(abbreviationTicker("f and o ban in stocks in india", { symbol: "F" }) ?? "", /F&O/);
  assert.match(abbreviationTicker("how does F&O trading work", { query: "o" }) ?? "", /F&O/);
  assert.match(abbreviationTicker("TCS P/E vs peers", { symbols: ["TCS.NS", "P"] }) ?? "", /P\/E/);
  assert.equal(abbreviationTicker("f and o ban", { symbol: "SAIL" }), null);
});

// --- answers -------------------------------------------------------------------

test("regression: 'what is f and o ban' explains the ban, links NSE, and makes no model or company call", async () => {
  const result = await runAgent({ message: "what is f and o ban" }, noModel);
  assert.match(result.answer, /95% of its market-wide position limit/);
  assert.doesNotMatch(result.answer, /Ford|Occidental/);
  assert.deepEqual(result.toolCalls, []);
  assert.equal(result.links?.[0]?.href, NSE_BAN_PAGE);
  assert.equal(result.links?.[0]?.label, "Check Today's NSE F&O Ban List");
});

test("regression: 'f and o ban in stocks in india' shows NSE's verified list — never Ford or Occidental", async () => {
  const result = await runAgent({ message: "f and o ban in stocks in india" }, { ...noModel, now, foBanList: list("2026-10-26", ["AMBUJACEM", "KAYNES", "SAIL"]) });
  assert.deepEqual(result.toolCalls.map((c) => c.tool), ["get_fo_ban_list"]);
  assertNoCompanyLookups(result);
  assert.match(result.answer, /trade date 26 Oct 2026/);
  assert.match(result.answer, /AMBUJACEM[\s\S]*KAYNES[\s\S]*SAIL/);
  assert.doesNotMatch(result.answer, /Ford|Occidental/);
  assert.equal(result.links?.[0]?.href, NSE_BAN_PAGE);
  assert.ok(result.links?.some((l) => l.href === FO_BAN_URL && /2026-10-26/.test(l.label)));
});

test("regression: 'which stocks are in the F&O ban today?' shows the list with its trade date and source", async () => {
  const result = await runAgent({ message: "which stocks are in the F&O ban today?" }, { ...noModel, now, foBanList: list("2026-10-26", ["SAIL"]) });
  assert.match(result.answer, /\| 1 \| SAIL \|/);
  assert.match(result.answer, /Source: NSE, fo_secban\.csv/);
  assert.deepEqual(result.warnings, []);
});

test("a ban file older than today is flagged, and an empty file says no securities are in the ban", async () => {
  const stale = await runAgent({ message: "which stocks are in the F&O ban today?" }, { ...noModel, now, foBanList: list("2026-10-22", ["SAIL"]) });
  assert.ok(stale.warnings.some((w) => /before today/.test(w)));
  const empty = await runAgent({ message: "which stocks are in the F&O ban today?" }, { ...noModel, now, foBanList: list("2026-10-26", []) });
  assert.match(empty.answer, /no securities/);
});

test("regression: when NSE can't be reached the list isn't invented — the ban is explained and NSE linked", async () => {
  const result = await runAgent({ message: "f and o ban in stocks in india" }, { ...noModel, foBanList: async () => null });
  assert.match(result.answer, /couldn't fetch NSE's ban-period file/);
  assert.match(result.answer, /95% of its market-wide position limit/);
  assert.doesNotMatch(result.answer, /\| Security \|/);
  assert.doesNotMatch(result.answer, /StockSphere resources/);
  assert.equal(result.links?.[0]?.href, NSE_BAN_PAGE);
});

test("regression: 'What is MWPL?' explains the position limit and the ban, with the NSE link", async () => {
  const result = await runAgent({ message: "What is MWPL?" }, noModel);
  assert.match(result.answer, /MWPL \(market-wide position limit\)/);
  assert.match(result.answer, /F&O ban period/);
  assert.equal(result.links?.[0]?.href, NSE_BAN_PAGE);
});

test("'Is SAIL in the F&O ban?' goes to the model with only F&O tools; a company lookup can't run", async () => {
  const offered: string[][] = [];
  let call = 0;
  const result = await runAgent({ message: "Is SAIL in the F&O ban?" }, {
    foBanList: list("2026-10-26", ["SAIL"]),
    getChatCompletion: async (_messages, tools) => {
      offered.push(names(tools));
      call += 1;
      if (call === 1) return { content: null, toolCalls: [{ id: "c", name: "get_company", arguments: '{"symbol":"F"}' }] };
      return { content: "Yes — SAIL is in NSE's ban list for 26 Oct 2026.", toolCalls: null };
    },
  });
  for (const tool of COMPANY_TOOLS) assert.ok(!offered[0].includes(tool));
  assert.equal(result.toolCalls[0].ok, false);
  assert.equal(result.links?.[0]?.href, NSE_BAN_PAGE);
});

test("anywhere else, a ticker cut from 'F and O' is refused with a note instead of being looked up", async () => {
  let note = "";
  let call = 0;
  await runAgent({ message: "F and O trading volumes in Reliance today" }, {
    getChatCompletion: async (messages) => {
      call += 1;
      if (call === 1) return { content: null, toolCalls: [{ id: "f", name: "get_company", arguments: '{"symbol":"F"}' }] };
      note = String(messages.find((m) => m.role === "tool")?.content);
      return { content: "Futures and options are derivatives…", toolCalls: null };
    },
  });
  assert.match(note, /part of F&O \(futures and options\), not stock tickers/);
});

// --- navigation ------------------------------------------------------------------

test("regression: 'Show me Ford stock' still opens Ford's stock page", async () => {
  const deps = { runTool: async (): Promise<ToolResult<unknown>> => ({ ok: true, data: { bestMatch: { symbol: "F", name: "Ford Motor Company" } }, source: "Symbol search", fetchedAt: "2026-10-24T06:00:00Z" }) };
  const result = await answerNavigation("Show me Ford stock", deps, "c");
  assert.equal(result?.links?.[0]?.href, "/stock/F");
});

test("'Show me the F&O ban list' is never looked up as a company", async () => {
  const deps = { runTool: async (): Promise<ToolResult<unknown>> => { throw new Error("no lookup expected"); } };
  assert.equal(await answerNavigation("Show me the F&O ban list", deps, "c"), null);
  assert.equal(await answerNavigation("show f and o ban", deps, "c"), null);
});
