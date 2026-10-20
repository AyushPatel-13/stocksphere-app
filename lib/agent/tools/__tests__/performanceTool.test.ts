import { test } from "node:test";
import assert from "node:assert/strict";

import type { History } from "@/lib/services/history";
import { getPerformance, periodReturn, pickCandidate, performanceTool } from "../performanceTool";
import { ANSWER_TTL_MS, createAnswerCache, normaliseQuestion } from "../../answerCache";
import { statusOf, toLLMError } from "../../llm/client";
import type { AgentResponse } from "@/lib/types/agent";

const DAY = 86_400_000;
const END = Date.parse("2026-10-19T03:45:00.000Z");
const bar = (daysAgo: number, c: number, h = c, l = c) => ({ t: END - daysAgo * DAY, o: c, h, l, c, v: 1 });

test("period return compares the last close with the last close on or before the start", () => {
  const candles = [bar(40, 90), bar(31, 100, 101, 99), bar(29, 105), bar(10, 120, 130, 110), bar(0, 110)];
  const r = periodReturn(candles, "1m")!;
  assert.equal(r.startDate, "2026-09-18");
  assert.equal(r.startClose, 100);
  assert.equal(r.endClose, 110);
  assert.equal(r.returnPct, 10);
  assert.equal(r.periodHigh, 130);
  assert.equal(r.periodLow, 99);
  assert.equal(r.annualisedPct, null);
});

test("history that doesn't reach back far enough gives no figure rather than a shorter period", () => {
  assert.equal(periodReturn([bar(10, 100), bar(0, 110)], "1m"), null);
  // A start a few days late (within tolerance) is used, with its real date.
  const late = periodReturn([bar(363, 100), bar(0, 110)], "1y")!;
  assert.equal(late.returnPct, 10);
  assert.equal(periodReturn([bar(350, 100), bar(0, 110)], "1y"), null);
  assert.equal(periodReturn([bar(0, 110)], "1w"), null);
});

test("annualised return for a year or more", () => {
  const r = periodReturn([bar(366, 100), bar(0, 121)], "1y")!;
  assert.equal(r.returnPct, 21);
  assert.ok(r.annualisedPct !== null && Math.abs(r.annualisedPct - 20.95) < 0.2);
});

test("candidate picking: exact ticker or name wins; ties are ambiguous", () => {
  const tcs = { symbol: "TCS.NS", name: "TATA CONSULTANCY SERV LT" };
  const tataMotors = { symbol: "TATAMOTORS.NS", name: "TATA MOTORS LIMITED" };
  const tataSteel = { symbol: "TATASTEEL.NS", name: "TATA STEEL LIMITED" };
  const infy = { symbol: "INFY.NS", name: "Infosys Limited" };
  const hcl = { symbol: "HCL-INSYS.NS", name: "HCL INFOSYSTEMS LTD" };

  assert.deepEqual(pickCandidate("TCS", [tcs, tataMotors]), { match: tcs });
  assert.deepEqual(pickCandidate("Infosys", [hcl, infy]), { match: infy });
  const tata = pickCandidate("Tata", [tataMotors, tataSteel, tcs]);
  assert.ok(tata && "tied" in tata && tata.tied.length >= 2);
  assert.equal(pickCandidate("x", []), null);
});

function history(candles: ReturnType<typeof bar>[], currency = "INR"): History {
  return {
    type: "stock", symbol: "X", name: null, unit: "currency", currency, range: "1y", interval: "1d", candles,
    previousClose: null, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, marketTime: null, sessionStart: null, sessionEnd: null, source: "Yahoo",
  };
}

test("getPerformance resolves each name and computes returns in one call", async () => {
  const result = await getPerformance(
    { stocks: ["TCS", "Infosys", "Tata", "Nothing", "NoHistory"], period: "1m" },
    {
      resolve: async (q) =>
        ({
          TCS: [{ symbol: "TCS.NS", name: "TATA CONSULTANCY SERV LT" }],
          Infosys: [{ symbol: "INFY.NS", name: "Infosys Limited" }],
          Tata: [{ symbol: "TATAMOTORS.NS", name: "TATA MOTORS LIMITED" }, { symbol: "TATASTEEL.NS", name: "TATA STEEL LIMITED" }],
          Nothing: [],
          NoHistory: [{ symbol: "NOHISTORY.NS", name: "NoHistory Ltd" }],
        })[q] ?? null,
      history: async (symbol) =>
        symbol === "TCS.NS" ? history([bar(31, 2190), bar(0, 2460.9)]) : symbol === "INFY.NS" ? history([bar(31, 1060), bar(0, 1161.2)]) : null,
    }
  );

  const [tcs, infy, tata, nothing, noHistory] = result.rows;
  assert.equal(tcs.status === "ok" && tcs.returnPct, 12.37);
  assert.equal(infy.status === "ok" && infy.returnPct, 9.55);
  assert.equal(infy.status === "ok" && infy.currency, "INR");
  assert.equal(tata.status, "ambiguous");
  assert.equal(nothing.status, "not_found");
  assert.deepEqual(noHistory, { query: "NoHistory", status: "no_data", symbol: "NOHISTORY.NS" });
});

test("get_performance validates its arguments", () => {
  assert.equal(performanceTool.argsSchema.safeParse({ stocks: ["TCS"], period: "1m" }).success, true);
  assert.equal(performanceTool.argsSchema.safeParse({ stocks: [], period: "1m" }).success, false);
  assert.equal(performanceTool.argsSchema.safeParse({ stocks: ["a", "b", "c", "d", "e", "f"], period: "1m" }).success, false);
  assert.equal(performanceTool.argsSchema.safeParse({ stocks: ["TCS"], period: "2w" }).success, false);
});

/* ------------------------------------------------------------ answer cache */

const answer = (text: string, warnings: string[] = []): AgentResponse => ({ answer: text, toolCalls: [], sources: [], warnings, conversationId: "c" });

test("repeat questions are answered from the cache until it expires; partial answers aren't cached", () => {
  let clock = 0;
  const cache = createAnswerCache(() => clock);
  assert.equal(normaliseQuestion("  What's the PRICE of TCS?? "), "what s the price of tcs");

  cache.set("Price of TCS?", answer("₹2,460.90"));
  assert.equal(cache.get("price of tcs")?.answer, "₹2,460.90");
  clock = ANSWER_TTL_MS + 1;
  assert.equal(cache.get("price of tcs"), null);

  cache.set("compare", answer("partial", ["Stopped gathering data"]));
  assert.equal(cache.get("compare"), null);
});

/* ------------------------------------------------------------ provider errors */

test("provider errors become plain messages without account details", () => {
  const groq429 = Object.assign(new Error("429 Rate limit reached for model in organization org_abc"), { status: 429 });
  assert.equal(statusOf(groq429), 429);
  const message = toLLMError(groq429).message;
  assert.match(message, /busy/);
  assert.doesNotMatch(message, /org_/);
  assert.match(toLLMError(new Error("socket hang up")).message, /didn't respond/);
  assert.match(toLLMError(Object.assign(new Error("x"), { status: 401 })).message, /configured/);
});

import { createSymbolResolverTool } from "../symbolResolverTool";
import type { SymbolResolution } from "../../types";

test("resolve_symbol reports a bestMatch for a plain ticker and none for a tie", async () => {
  const tool = createSymbolResolverTool(async () => [
    { trading_symbol: "RELIANCE", name: "RELIANCE INDUSTRIES LTD", instrument_key: "NSE_EQ|1" },
    { trading_symbol: "RPOWER", name: "RELIANCE POWER LTD.", instrument_key: "NSE_EQ|2" },
  ] as never);
  const reliance = (await tool.execute({ query: "Reliance" })).data as SymbolResolution;
  assert.equal(reliance.bestMatch?.symbol, "RELIANCE.NS");

  const tied = createSymbolResolverTool(async () => [
    { trading_symbol: "TATASTEEL", name: "TATA STEEL LIMITED", instrument_key: "NSE_EQ|3" },
    { trading_symbol: "TATAPOWER", name: "TATA POWER CO LTD", instrument_key: "NSE_EQ|4" },
  ] as never);
  assert.equal(((await tied.execute({ query: "Tata" })).data as SymbolResolution).bestMatch, null);
});
