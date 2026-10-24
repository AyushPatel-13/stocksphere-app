import { randomUUID } from "node:crypto";

import { LLMError } from "../errors";
import { getChatCompletion as defaultGetChatCompletion } from "../llm/client";
import { dateContext } from "../llm/prompts";
import { executeWithTimeout, TOOL_TIMEOUT_MS } from "../orchestrator";
import { getToolByName } from "../tools";
import type { ToolResult } from "../types";
import type { AgentResponse, AgentToolCallTrace } from "@/lib/types/agent";
import { ensureDisclaimer, renderCitations, serialiseEvidence, type Evidence } from "./citations";
import type { Workflow } from "./detect";
import { analysePortfolio, type HoldingInput, type PriceInput } from "./portfolio";
import { workflowSystemPrompt } from "./prompts";

/**
 * Research workflows: gather the evidence on the server, in parallel, through
 * the same allowlisted tools the chat uses (no second set of provider
 * integrations), then make one model call to write it up.
 *
 * Returns null when the workflow can't start — the company couldn't be
 * identified — so the caller falls back to the open tool loop, which can ask
 * the user to clarify.
 */

export type WorkflowContext = {
  /** The verified member; portfolio data is read for this account only. */
  userId: string;
  /** Their Supabase access token, used so row-level security applies. */
  accessToken: string;
};

export interface WorkflowDeps {
  getChatCompletion: typeof defaultGetChatCompletion;
  runTool: (name: string, args: unknown) => Promise<ToolResult<unknown>>;
  /** The member's holdings, or null when they can't be read. */
  loadHoldings: (ctx: WorkflowContext) => Promise<HoldingInput[] | null>;
  now: () => number;
}

const WRITE_UP_DEADLINE_MS = 45_000;
const MAX_HOLDINGS = 25;

/** Runs an allowlisted tool with validated arguments and a time limit. */
export async function runAllowlistedTool(name: string, args: unknown): Promise<ToolResult<unknown>> {
  const tool = getToolByName(name);
  if (!tool) return { ok: false, data: null, source: name, fetchedAt: new Date().toISOString() };
  const parsed = tool.argsSchema.safeParse(args);
  if (!parsed.success) return { ok: false, data: null, source: tool.name, fetchedAt: new Date().toISOString() };
  return executeWithTimeout(() => tool.execute(parsed.data), tool.name, TOOL_TIMEOUT_MS);
}

type Resolved = { symbol: string; name: string };

class Gatherer {
  evidence: Evidence[] = [];
  trace: AgentToolCallTrace[] = [];
  sources = new Set<string>();
  missing: string[] = [];

  constructor(private readonly deps: WorkflowDeps) {}

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult<unknown>> {
    const result = await this.deps.runTool(name, args);
    this.trace.push({ tool: name, input: args, ok: result.ok, source: result.source });
    if (result.ok) this.sources.add(result.source);
    return result;
  }

  add(item: Omit<Evidence, "id">) {
    this.evidence.push({ ...item, id: `E${this.evidence.length + 1}` });
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const isIndian = (symbol: string) => /\.(NS|BO)$/i.test(symbol);

async function resolve(g: Gatherer, query: string): Promise<Resolved | null> {
  const result = await g.call("resolve_symbol", { query });
  const best = (result.data as { bestMatch?: { symbol?: string; name?: string } } | null)?.bestMatch;
  if (!result.ok || !best?.symbol) return null;
  return { symbol: best.symbol, name: best.name ?? best.symbol };
}

function addPrice(g: Gatherer, r: ToolResult<unknown>, label: string) {
  if (!r.ok || !r.data) return g.missing.push(`current price for ${label}`);
  const d = r.data as Record<string, unknown>;
  g.add({
    title: `Latest price, ${label}`,
    source: `${r.source}${str(d.source) ? ` (${d.source})` : ""}`,
    fetchedAt: r.fetchedAt,
    asOf: str(d.lastUpdated),
    data: { symbol: d.symbol, price: d.price, currency: d.currency, change: d.change, changePercent: d.changePercent, dayHigh: d.high, dayLow: d.low, previousClose: d.previousClose, volume: d.volume },
  });
}

function addFinancials(g: Gatherer, r: ToolResult<unknown>, label: string) {
  if (!r.ok || !r.data) return g.missing.push(`valuation and ratios for ${label}`);
  g.add({ title: `Valuation and ratios, ${label} (each metric's own source in "sources")`, source: r.source, fetchedAt: r.fetchedAt, data: r.data });
}

function addPerformance(g: Gatherer, r: ToolResult<unknown>, period: string) {
  if (!r.ok || !r.data) return g.missing.push(`${period} price performance`);
  const rows = ((r.data as { rows?: Record<string, unknown>[] }).rows ?? []).filter((row) => row.status === "ok");
  if (rows.length === 0) return g.missing.push(`${period} price performance`);
  g.add({
    title: `Price return over ${period} (daily closes, excludes dividends)`,
    source: r.source,
    fetchedAt: r.fetchedAt,
    data: rows.map((row) => ({ symbol: row.symbol, currency: row.currency, from: `${row.startDate} close ${row.startClose}`, to: `${row.endDate} close ${row.endClose}`, returnPct: row.returnPct, periodHigh: row.periodHigh, periodLow: row.periodLow })),
  });
}

function addCompany(g: Gatherer, r: ToolResult<unknown>, label: string) {
  if (!r.ok || !r.data) return g.missing.push(`company description for ${label}`);
  const d = r.data as Record<string, unknown>;
  const descSource = str(d.descriptionSource);
  const url = descSource?.match(/https?:\/\/\S+/)?.[0] ?? null;
  g.add({
    title: `Company profile, ${label}`,
    source: descSource ? `${r.source}; description from ${descSource.replace(/:?\s*https?:\/\/\S+/, "")}` : r.source,
    fetchedAt: r.fetchedAt,
    url,
    data: { name: d.name, exchange: d.exchange, country: d.country, currency: d.currency, sector: str(d.sector), industry: str(d.industry), description: str(d.description)?.slice(0, 700) ?? null },
  });
}

function addNews(g: Gatherer, r: ToolResult<unknown>, label: string, max: number) {
  const items = r.ok && Array.isArray(r.data) ? (r.data as Record<string, unknown>[]) : [];
  if (items.length === 0) return g.missing.push(`recent news for ${label}`);
  for (const n of items.slice(0, max)) {
    const url = str(n.url);
    g.add({
      title: `News: ${str(n.headline) ?? "untitled"}`,
      source: str(n.source) ?? r.source,
      fetchedAt: r.fetchedAt,
      asOf: str(n.publishedAt),
      url: url && /^https?:\/\//.test(url) ? url : null,
      data: { headline: n.headline, summary: str(n.summary)?.slice(0, 240) ?? null, publishedAt: n.publishedAt },
    });
  }
}

async function gatherResearch(g: Gatherer, query: string): Promise<string | null> {
  const company = await resolve(g, query);
  if (!company) return null;
  const { symbol, name } = company;
  const [price, profile, financials, performance, news, earnings] = await Promise.all([
    g.call("get_price", { symbol }),
    g.call("get_company", { symbol }),
    g.call("get_financials", { symbol }),
    g.call("get_performance", { stocks: [symbol], period: "1y" }),
    g.call("get_news", { symbol, limit: 5 }),
    isIndian(symbol) ? Promise.resolve(null) : g.call("get_earnings_calendar", { symbols: [symbol.replace(/\..*$/, "")], days: 30 }),
  ]);
  addPrice(g, price, name);
  addCompany(g, profile, name);
  addFinancials(g, financials, name);
  addPerformance(g, performance, "1 year");
  addNews(g, news, name, 5);
  if (earnings) {
    const events = (earnings.data as { events?: unknown[] } | null)?.events ?? [];
    if (earnings.ok && events.length) g.add({ title: `Upcoming earnings date, ${name}`, source: earnings.source, fetchedAt: earnings.fetchedAt, data: events.slice(0, 2) });
  } else {
    g.missing.push("earnings dates (only US listings are covered)");
  }
  return `${name} (${symbol})`;
}

async function gatherMove(g: Gatherer, query: string): Promise<string | null> {
  const company = await resolve(g, query);
  if (!company) return null;
  const { symbol, name } = company;
  const index = isIndian(symbol) ? "NIFTY" : "SPX";
  const [price, week, market, news] = await Promise.all([
    g.call("get_price", { symbol }),
    g.call("get_performance", { stocks: [symbol], period: "1w" }),
    g.call("get_market_quotes", { kind: "indices", symbols: [index] }),
    g.call("get_news", { symbol, limit: 8 }),
  ]);
  addPrice(g, price, name);
  addPerformance(g, week, "1 week");
  const quotes = (market.data as { quotes?: Record<string, unknown>[] } | null)?.quotes ?? [];
  if (market.ok && quotes.length) {
    g.add({ title: `Index move (${quotes[0].name ?? index})`, source: market.source, fetchedAt: market.fetchedAt, asOf: str(quotes[0].asOf), data: quotes[0] });
  } else {
    g.missing.push("the index move for market context");
  }
  addNews(g, news, name, 8);
  return `${name} (${symbol})`;
}

async function gatherCompare(g: Gatherer, queries: string[]): Promise<string | null> {
  const resolved = (await Promise.all(queries.map((q) => resolve(g, q)))).filter((r): r is Resolved => r !== null);
  const unique = resolved.filter((r, i) => resolved.findIndex((x) => x.symbol === r.symbol) === i);
  if (unique.length < 2) return null;
  const [performance, ...rest] = await Promise.all([
    g.call("get_performance", { stocks: unique.map((r) => r.symbol), period: "1y" }),
    ...unique.flatMap((r) => [g.call("get_price", { symbol: r.symbol }), g.call("get_financials", { symbol: r.symbol })]),
  ]);
  unique.forEach((r, i) => {
    addPrice(g, rest[i * 2], r.name);
    addFinancials(g, rest[i * 2 + 1], r.name);
  });
  addPerformance(g, performance, "1 year");
  return unique.map((r) => `${r.name} (${r.symbol})`).join(" vs ");
}

async function gatherPortfolio(g: Gatherer, ctx: WorkflowContext, deps: WorkflowDeps): Promise<string | "empty" | "unavailable"> {
  const holdings = await deps.loadHoldings(ctx);
  if (holdings === null) return "unavailable";
  if (holdings.length === 0) return "empty";
  const list = holdings.slice(0, MAX_HOLDINGS);
  const quotes = await Promise.all(list.map((h) => g.call("get_price", { symbol: h.symbol })));
  const prices: Record<string, PriceInput | null> = {};
  list.forEach((h, i) => {
    const d = quotes[i].ok ? (quotes[i].data as Record<string, unknown>) : null;
    prices[h.symbol] =
      d && typeof d.price === "number"
        ? { price: d.price, currency: String(d.currency ?? "INR"), changePercent: typeof d.changePercent === "number" ? d.changePercent : null, asOf: str(d.lastUpdated) }
        : null;
  });
  const figures = analysePortfolio(list, prices);
  g.add({
    title: "Your portfolio, calculated by StockSphere from your holdings and the latest prices",
    source: "StockSphere portfolio calculation (prices: StockSphere Market Quote Service)",
    fetchedAt: new Date(deps.now()).toISOString(),
    data: figures,
  });
  if (holdings.length > MAX_HOLDINGS) g.missing.push(`${holdings.length - MAX_HOLDINGS} holdings beyond the first ${MAX_HOLDINGS}`);
  if (figures.unpriced.length) g.missing.push(`prices for ${figures.unpriced.join(", ")}`);
  return "your portfolio";
}

/** What the member sees if the write-up call fails: the data itself, verbatim. */
function evidenceDigest(evidence: Evidence[]): string {
  const lines = evidence.map((e) => `- ${e.title} — ${e.source}${e.url ? ` ([link](${e.url}))` : ""}`);
  return ["StockSphere AI couldn't write the note right now (the AI service is busy), but here's the data it gathered:", "", ...lines].join("\n");
}

export async function runWorkflow(
  workflow: Workflow,
  question: string,
  ctx: WorkflowContext,
  deps: WorkflowDeps,
  conversationId: string = randomUUID()
): Promise<AgentResponse | null> {
  const g = new Gatherer(deps);
  const started = deps.now();
  const respond = (answer: string, warnings: string[] = []): AgentResponse => ({
    answer,
    toolCalls: g.trace,
    sources: Array.from(g.sources),
    warnings,
    conversationId,
  });

  let subject: string | null;
  if (workflow.type === "portfolio") {
    const outcome = await gatherPortfolio(g, ctx, deps);
    if (outcome === "unavailable") return respond("I couldn't read your holdings just now. Please try again, or open the Portfolio page to check they load.");
    if (outcome === "empty") return respond("You haven't added any holdings yet. Add them on the Portfolio page and I can review allocation, concentration and returns for you.");
    subject = outcome;
  } else if (workflow.type === "research") {
    subject = await gatherResearch(g, workflow.query);
  } else if (workflow.type === "explain_move") {
    subject = await gatherMove(g, workflow.query);
  } else {
    subject = await gatherCompare(g, workflow.queries);
  }
  if (subject === null) return null;

  if (g.evidence.length === 0) {
    return respond(`I couldn't retrieve any data for ${subject} right now, so I can't write a note without guessing. Please try again shortly.`, ["No data was available from the sources."]);
  }

  const missing = g.missing.length ? `\n\nUNAVAILABLE (say so where relevant): ${g.missing.join("; ")}.` : "";
  const messages = [
    { role: "system" as const, content: workflowSystemPrompt(workflow.type, dateContext(new Date(deps.now()))) },
    { role: "user" as const, content: `QUESTION: ${question}\nSUBJECT: ${subject}${missing}\n\nEVIDENCE:\n${serialiseEvidence(g.evidence)}` },
  ];

  try {
    const completion = await deps.getChatCompletion(messages, [], { toolChoice: "none", deadline: started + WRITE_UP_DEADLINE_MS, longAnswer: true });
    const text = completion.content?.trim();
    if (!text) return respond(evidenceDigest(g.evidence), ["The AI service returned an empty answer; showing the retrieved data."]);
    const report = renderCitations(text, g.evidence);
    const warnings: string[] = [];
    // The disclaimer is guaranteed here rather than trusted to the model; a
    // note cut off by the provider's output limit loses it otherwise.
    report.answer = ensureDisclaimer(report.answer, text);
    if (report.removedUrls) warnings.push(`Removed ${report.removedUrls} link(s) that didn't come from a retrieved source.`);
    if (report.unknownCitations) warnings.push(`Removed ${report.unknownCitations} citation(s) to evidence that doesn't exist.`);
    if (report.cited.length === 0) warnings.push("The note didn't cite its evidence; treat its figures with care.");
    return respond(report.answer, warnings);
  } catch (error) {
    if (!(error instanceof LLMError)) throw error;
    return respond(evidenceDigest(g.evidence), ["The AI service didn't respond; showing the retrieved data instead of a written note."]);
  }
}
