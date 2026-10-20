import { test } from "node:test";
import assert from "node:assert/strict";

import { calculate, calculatorTool } from "../calculatorTool";

test("percent change is exact: the 1,060 → 1,161.2 case the model misquoted", () => {
  const out = calculate({ operation: "percent_change", values: [1060, 1161.2] });
  assert.equal(out.ok && out.result.rounded, 9.55);
  assert.equal(out.ok && out.result.unit, "percent");

  const tcs = calculate({ operation: "percent_change", values: [2188.8, 2465] });
  assert.equal(tcs.ok && tcs.result.rounded, 12.62);

  const down = calculate({ operation: "percent_change", values: [200, 150], decimals: 1 });
  assert.equal(down.ok && down.result.rounded, -25);
});

test("difference, ratio, sum, average, min, max and cagr", () => {
  const value = (args: Parameters<typeof calculate>[0]) => {
    const out = calculate(args);
    return out.ok ? out.result.rounded : out.reason;
  };
  assert.equal(value({ operation: "difference", values: [10, 7.5] }), -2.5);
  assert.equal(value({ operation: "ratio", values: [3, 4] }), 0.75);
  assert.equal(value({ operation: "sum", values: [1, 2, 3.5] }), 6.5);
  assert.equal(value({ operation: "average", values: [1, 2, 3, 4] }), 2.5);
  assert.equal(value({ operation: "min", values: [5, -1, 3] }), -1);
  assert.equal(value({ operation: "max", values: [5, -1, 3] }), 5);
  assert.equal(value({ operation: "cagr", values: [100, 200], years: 5 }), 14.87);
});

test("impossible calculations are refused, never guessed", () => {
  const reason = (args: Parameters<typeof calculate>[0]) => {
    const out = calculate(args);
    return out.ok ? null : out.reason;
  };
  assert.match(reason({ operation: "percent_change", values: [0, 5] })!, /zero/);
  assert.match(reason({ operation: "percent_change", values: [1, 2, 3] })!, /exactly two/);
  assert.match(reason({ operation: "ratio", values: [1, 0] })!, /zero/);
  assert.match(reason({ operation: "cagr", values: [100, 200] })!, /years/);
  assert.match(reason({ operation: "cagr", values: [-1, 200], years: 2 })!, /positive/);
});

test("the tool validates arguments and reports refusals as ok: false", async () => {
  assert.equal(calculatorTool.argsSchema.safeParse({ operation: "sqrt", values: [4] }).success, false);
  assert.equal(calculatorTool.argsSchema.safeParse({ operation: "sum", values: [] }).success, false);
  assert.equal(calculatorTool.argsSchema.safeParse({ operation: "sum", values: [Infinity] }).success, false);

  const ok = await calculatorTool.execute({ operation: "sum", values: [1, 2] });
  assert.equal(ok.ok, true);
  const refused = await calculatorTool.execute({ operation: "ratio", values: [1, 0] });
  assert.equal(refused.ok, false);
  assert.equal(refused.data, null);
  assert.match(refused.source, /refused/);
});

/* ------------------------------------------------------------ run_screen */

import { runScreenTool, screenerTool } from "../screenerTool";
import { emptyRow } from "@/lib/services/watchlistRows";
import { NIFTY_50_SYMBOLS } from "@/lib/data/instruments/india";

test("run_screen returns matches with reasons from the chosen universe", async () => {
  const asked: string[][] = [];
  const result = await runScreenTool({ screen: "near_high", market: "india", limit: 5 }, async (symbols) => {
    asked.push(symbols);
    return symbols.map((symbol, i) => ({
      ...emptyRow(symbol),
      price: i === 0 ? 99 : 50,
      changePercent: 1,
      fiftyTwoWeekHigh: 100,
      fiftyTwoWeekLow: 40,
      asOf: "2026-10-20T10:00:00.000Z",
    }));
  });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].length, NIFTY_50_SYMBOLS.length);
  assert.equal(result?.universe, "NIFTY 50");
  assert.equal(result?.total, 1);
  assert.match(result!.matches[0].reasons[0], /1\.00% below its 52-week high/);
  assert.equal(result?.asOf, "2026-10-20T10:00:00.000Z");
});

test("run_screen reports no data instead of an empty ranking when nothing is priced", async () => {
  assert.equal(await runScreenTool({ screen: "gainers" }, async (symbols) => symbols.map((s) => emptyRow(s))), null);
  assert.equal(screenerTool.argsSchema.safeParse({ screen: "moonshots" }).success, false);
  assert.equal(screenerTool.argsSchema.safeParse({ screen: "gainers", limit: 50 }).success, false);
});
