import { test } from "node:test";
import assert from "node:assert/strict";

import { detectWorkflow } from "../detect";

test("research phrasings start a research workflow", () => {
  for (const [q, query] of [
    ["Research Reliance Industries", "Reliance Industries"],
    ["research TCS for me", "TCS"],
    ["Analyze Infosys stock", "Infosys"],
    ["Give me a full research report on HDFC Bank", "HDFC Bank"],
    ["deep dive into Eternal?", "Eternal"],
  ]) {
    assert.deepEqual(detectWorkflow(q), { type: "research", query }, q);
  }
});

test("why-did-it-move questions start a move explanation", () => {
  assert.deepEqual(detectWorkflow("Why did Eternal rise on Friday?"), { type: "explain_move", query: "Eternal" });
  assert.deepEqual(detectWorkflow("why is TCS stock down today"), { type: "explain_move", query: "TCS" });
  assert.deepEqual(detectWorkflow("Why has Adani Enterprises fallen so much?"), { type: "explain_move", query: "Adani Enterprises" });
});

test("comparisons of two or three companies start a comparison", () => {
  assert.deepEqual(detectWorkflow("Compare TCS and Infosys"), { type: "compare", queries: ["TCS", "Infosys"] });
  assert.deepEqual(detectWorkflow("compare HDFC Bank with ICICI Bank and Axis Bank"), { type: "compare", queries: ["HDFC Bank", "ICICI Bank", "Axis Bank"] });
  assert.deepEqual(detectWorkflow("AAPL vs MSFT"), { type: "compare", queries: ["AAPL", "MSFT"] });
  assert.equal(detectWorkflow("Compare TCS and TCS"), null);
  assert.equal(detectWorkflow("compare a, b, c and d"), null);
});

test("portfolio reviews are recognised", () => {
  for (const q of ["Analyze my portfolio", "please review my holdings", "How is my portfolio doing?", "Can you check my investments"]) {
    assert.deepEqual(detectWorkflow(q), { type: "portfolio" }, q);
  }
});

test("market-wide, conceptual and vague questions stay with the tool loop", () => {
  for (const q of [
    "Why is the market down today?",
    "why did nifty fall",
    "What is a P/E ratio?",
    "Explain the P/E ratio with an example",
    "Should I buy TCS?",
    "What's the price of TCS?",
    "compare them",
    "Research",
    "",
  ]) {
    assert.equal(detectWorkflow(q), null, q);
  }
});

test("the stock page's context line is understood", () => {
  const ctx = '[Context: user is viewing TCS; "this stock"/"this company" means TCS.]';
  assert.deepEqual(detectWorkflow(`${ctx} Research TCS`), { type: "research", query: "TCS" });
  assert.deepEqual(detectWorkflow(`${ctx} Why did it move?`), { type: "explain_move", query: "TCS" });
  assert.deepEqual(detectWorkflow(`${ctx} research this stock`), { type: "research", query: "TCS" });
  assert.equal(detectWorkflow(`${ctx} What's the current price of TCS?`), null);
});
