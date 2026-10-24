import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { FO_BAN_URL } from "@/lib/apis/nseFoBan";
import { OFFICIAL, PAGES, safeLink, stockPath } from "../links";
import { answerNavigation, buildLinks, type ToolEvidence } from "../navigation";
import { runAgent } from "../orchestrator";
import type { ToolResult } from "../types";

const page = (route: string) => join(process.cwd(), "app", ...route.split("/").filter(Boolean), "page.tsx");
const ok = (data: unknown, source = "fake"): ToolResult<unknown> => ({ ok: true, data, source, fetchedAt: "2026-10-24T06:00:00Z" });

// --- the registry only names real routes -------------------------------------

test("every page the AI can link to exists in app/", () => {
  for (const { path } of PAGES) assert.ok(existsSync(page(path)), `missing route for ${path}`);
  assert.ok(existsSync(page("/stock/[symbol]")));
  assert.ok(existsSync(page("/community/ipo/[id]")));
});

test("stock pages use the bare symbol: TCS.NS → /stock/TCS, AAPL → /stock/AAPL", () => {
  assert.equal(stockPath("TCS.NS"), "/stock/TCS");
  assert.equal(stockPath("aapl"), "/stock/AAPL");
  assert.equal(stockPath("M&M.NS"), "/stock/M&M");
  assert.equal(stockPath("../admin"), null);
});

// --- URL safety ----------------------------------------------------------------

test("regression: malformed and unsafe links are rejected", () => {
  const bad = [
    { label: "x", href: "javascript:alert(1)", kind: "external" },
    { label: "x", href: "data:text/html,hi", kind: "external" },
    { label: "x", href: "http://www.nseindia.com/x", kind: "external" },
    { label: "x", href: "https://user:pw@www.nseindia.com/", kind: "external" },
    { label: "x", href: "https://127.0.0.1/x", kind: "external" },
    { label: "x", href: "https://www.nseindia.com:8443/x", kind: "external" },
    { label: "x", href: "not a url", kind: "external" },
    { label: "x", href: "https://evil.example/x", kind: "external" },
    { label: "x", href: "//evil.example", kind: "internal" },
    { label: "x", href: "/admin", kind: "internal" },
    { label: "x", href: "/stock/../moderation", kind: "internal" },
    { label: "", href: "/ipo", kind: "internal" },
    { label: "x", href: "/ipo", kind: "weird" },
  ] as never[];
  for (const link of bad) assert.equal(safeLink(link), null, JSON.stringify(link));
});

test("official sources, known pages and (only when allowed) https articles pass", () => {
  assert.ok(safeLink(OFFICIAL.nseFoBan));
  assert.ok(safeLink({ label: "IPOs", href: "/ipo", kind: "internal" }));
  assert.ok(safeLink({ label: "TCS", href: "/stock/TCS", kind: "internal" }));
  assert.equal(safeLink({ label: "a", href: "https://upstox.com/news/a", kind: "external" }), null);
  assert.ok(safeLink({ label: "a", href: "https://upstox.com/news/a", kind: "external" }, { allowArticles: true }));
});

// --- links that go with answers ----------------------------------------------------

test("regression: an F&O ban question links the official NSE page first, plus NSE Clearing", () => {
  const links = buildLinks("What is F&O ban in Indian market?", []);
  assert.equal(links[0].label, "Check Today's NSE F&O Ban List");
  assert.equal(links[0].href, "https://www.nseindia.com/static/products-services/equity-derivatives-risk-management-sec-ban");
  assert.equal(links[0].primary, true);
  assert.match(links[0].note ?? "", /next trade date/);
  assert.ok(links.some((l) => l.href === "https://www.nseclearing.in/risk-management/equity-derivatives/position-limits"));
});

test("regression: when today's list was really fetched, its file and trade date are linked too", () => {
  const calls: ToolEvidence[] = [{ tool: "get_fo_ban_list", input: {}, ok: true, data: { tradeDate: "2026-10-26", securities: ["SAIL"] } }];
  const links = buildLinks("Which stocks are currently in the F&O ban?", calls);
  assert.ok(links.some((l) => l.href === FO_BAN_URL && /2026-10-26/.test(l.label)));
});

test("regression: when the current list couldn't be retrieved, only the official page is linked — no list file", () => {
  const calls: ToolEvidence[] = [{ tool: "get_fo_ban_list", input: {}, ok: false, data: null }];
  const links = buildLinks("Which stocks are currently in the F&O ban?", calls);
  assert.equal(links[0].href, OFFICIAL.nseFoBan.href);
  assert.ok(!links.some((l) => l.href === FO_BAN_URL));
});

test("regression: a stock lookup links its StockSphere page; news links the real articles and the News page", () => {
  const calls: ToolEvidence[] = [
    { tool: "get_company", input: { symbol: "HDFCBANK.NS" }, ok: true, data: { name: "HDFC BANK LTD" } },
    { tool: "get_news", input: { symbol: "HDFCBANK.NS" }, ok: true, data: [{ headline: "HDFC Bank Q2", url: "https://upstox.com/news/hdfc-q2", source: "Upstox", publishedAt: "2026-10-22T08:00:00Z" }, { headline: "Bad", url: "javascript:alert(1)" }] },
  ];
  const links = buildLinks("Show me HDFC Bank news", calls);
  assert.deepEqual(links.map((l) => l.href), ["/stock/HDFCBANK", "https://upstox.com/news/hdfc-q2", "/news"]);
  assert.equal(links[0].label, "Hdfc Bank Ltd on StockSphere");
});

test("IPO, index, events, screener and portfolio answers link their pages", () => {
  const hrefs = (q: string, calls: ToolEvidence[]) => buildLinks(q, calls).map((l) => l.href);
  assert.deepEqual(hrefs("upcoming ipos", [{ tool: "get_ipos", input: {}, ok: true, data: [] }]), ["/ipo"]);
  assert.deepEqual(hrefs("Why did NIFTY fall today?", [{ tool: "get_market_quotes", input: { kind: "indices" }, ok: true, data: {} }]), ["/indices"]);
  assert.deepEqual(hrefs("earnings this week", [{ tool: "get_earnings_calendar", input: {}, ok: true, data: {} }]), ["/events"]);
  assert.deepEqual(hrefs("Analyze my portfolio", []), ["/portfolio"]);
});

// --- "open X" requests --------------------------------------------------------------

const noTools = { runTool: async () => { throw new Error("no tool should run"); } };

test("regression: 'Open heatmap', 'Show IPOs' and 'Open my portfolio' link the page, with no model or tool call", async () => {
  for (const [q, href] of [["Open heatmap", "/heatmap"], ["Show IPOs", "/ipo"], ["Open my portfolio", "/portfolio"], ["take me to the screener page", "/screener"], ["go to indices", "/indices"]]) {
    const result = await answerNavigation(q, noTools, "c");
    assert.ok(result, q);
    assert.deepEqual(result.links, [{ label: result.links![0].label, href, kind: "internal", primary: true }], q);
    assert.deepEqual(result.toolCalls, []);
  }
});

test("regression: 'Show me Reliance' resolves the company and links its stock page", async () => {
  const deps = { runTool: async () => ok({ bestMatch: { symbol: "RELIANCE.NS", name: "RELIANCE INDUSTRIES LTD" } }, "Symbol search") };
  const result = (await answerNavigation("Show me Reliance", deps, "c"))!;
  assert.equal(result.links![0].href, "/stock/RELIANCE");
  assert.match(result.answer, /Reliance Industries Ltd/);
});

test("a company match that isn't plainly what was asked is never linked", async () => {
  const deps = { runTool: async () => ok({ bestMatch: { symbol: "ABC.NS", name: "ABC LTD" } }) };
  assert.equal(await answerNavigation("show me zomato", deps, "c"), null);
  assert.equal(await answerNavigation("open the admin panel", { runTool: async () => ok({ bestMatch: null }) }, "c"), null);
});

test("requests that want an answer aren't treated as navigation", async () => {
  for (const q of ["Show me HDFC Bank news", "show TCS's P/E", "show me why NIFTY fell", "What is the P/E ratio?"]) {
    assert.equal(await answerNavigation(q, noTools, "c"), null, q);
  }
});

test("regression: a chat answer about the F&O ban carries the NSE link", async () => {
  let call = 0;
  const result = await runAgent({ message: "What is F&O ban in Indian market?" }, {
    getChatCompletion: async () => {
      call += 1;
      if (call === 1) return { content: null, toolCalls: [{ id: "g", name: "get_market_term", arguments: '{"term":"F&O ban"}' }] };
      return { content: "The F&O ban stops fresh positions once open interest passes 95% of MWPL.", toolCalls: null };
    },
  });
  assert.equal(result.links?.[0]?.href, OFFICIAL.nseFoBan.href);
});
