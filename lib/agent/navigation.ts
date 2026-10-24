import { FO_BAN_URL } from "@/lib/apis/nseFoBan";
import type { AgentResponse, AgentToolCallTrace } from "@/lib/types/agent";
import { OFFICIAL, pageFor, pageLink, safeLink, stockPath, type AgentLink } from "./links";
import type { ToolResult } from "./types";

/**
 * Links that go with an answer, built on the server from what actually
 * happened — the question and the tools that ran — never from model text:
 *
 *   F&O ban question       → the official NSE ban page (+ NSE Clearing), and
 *                            the day's file when it was really fetched
 *   a stock looked up      → its StockSphere page
 *   news fetched           → the articles themselves and the News page
 *   IPOs / indices / events / screens / portfolio → the matching page
 *
 * plus a fast path for "open the heatmap" / "show me Reliance", answered with
 * a link and no model call at all.
 */

export type ToolEvidence = { tool: string; input: Record<string, unknown>; ok: boolean; data: unknown };

const MAX_LINKS = 6;
const FO_BAN_QUESTION = /\b(?:f\s*&\s*o|f\s*and\s*o|fno|futures\s*(?:and|&)\s*options)\b[^?]*\bban\b|\bban\s*(?:list|period)\b|\bmwpl\b/i;
const SYMBOL_TOOLS = new Set(["get_price", "get_company", "get_financials", "get_news", "get_historical"]);

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function buildLinks(question: string, calls: ToolEvidence[]): AgentLink[] {
  const links: AgentLink[] = [];
  const add = (link: AgentLink | null, allowArticles = false) => {
    const safe = link && safeLink(link, { allowArticles });
    if (safe && !links.some((l) => l.href === safe.href)) links.push(safe);
  };
  const used = (tool: string) => calls.some((c) => c.tool === tool);

  // F&O ban: the verified list when it was really fetched, and the official page always.
  const banCall = calls.find((c) => c.tool === "get_fo_ban_list");
  const glossaryBan = calls.some((c) => c.tool === "get_market_term" && JSON.stringify(c.data ?? "").includes('"term":"fo_ban"'));
  if (FO_BAN_QUESTION.test(question) || banCall || glossaryBan) {
    add(OFFICIAL.nseFoBan);
    const list = banCall?.ok ? (banCall.data as { tradeDate?: string } | null) : null;
    if (list?.tradeDate) {
      add({ label: `NSE ban file for ${list.tradeDate}`, href: FO_BAN_URL, kind: "external", note: `The list StockSphere checked, for trade date ${list.tradeDate}.` });
    }
    add(OFFICIAL.nseClearingLimits);
  }

  // Stocks that were looked up → their StockSphere pages.
  const symbols: { symbol: string; name: string | null }[] = [];
  for (const call of calls) {
    if (!call.ok || !SYMBOL_TOOLS.has(call.tool) || typeof call.input.symbol !== "string") continue;
    const name = call.tool === "get_company" ? ((call.data as { name?: string } | null)?.name ?? null) : null;
    const existing = symbols.find((s) => s.symbol === call.input.symbol);
    if (existing) existing.name ??= name;
    else symbols.push({ symbol: call.input.symbol as string, name });
  }
  for (const { symbol, name } of symbols.slice(0, 3)) {
    const path = stockPath(symbol);
    if (path) add({ label: `${name ? titleCase(name) : path.slice(7)} on StockSphere`, href: path, kind: "internal" });
  }

  // News articles that were actually retrieved.
  for (const call of calls.filter((c) => c.tool === "get_news" && c.ok && Array.isArray(c.data))) {
    for (const article of (call.data as { headline?: string; url?: string; source?: string; publishedAt?: string }[]).slice(0, 3)) {
      if (!article.url || !article.headline) continue;
      add({ label: article.headline.slice(0, 90), href: article.url, kind: "external", note: [article.source, article.publishedAt && formatTime(article.publishedAt)].filter(Boolean).join(" · ") }, true);
    }
  }
  if (used("get_news")) add(pageLink("/news"));
  if (used("get_ipos")) add(pageLink("/ipo"));
  if (used("get_market_movers") || calls.some((c) => c.tool === "get_market_quotes" && c.input.kind === "indices")) add(pageLink("/indices"));
  if (used("get_earnings_calendar")) add(pageLink("/events"));
  if (used("run_screen")) add(pageLink("/screener"));
  if (/\bmy\s+(?:portfolio|holdings|investments)\b/i.test(question)) add(pageLink("/portfolio"));
  if (/\bmy\s+watchlists?\b/i.test(question)) add(pageLink("/watchlist"));

  return links.slice(0, MAX_LINKS);
}

function titleCase(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bLtd\b/, "Ltd").replace(/\bServ Lt\b/, "Services");
}

/** Tool calls from a request's fetched results ("tool:{args}" → result). */
export function evidenceFromFetched(fetched: Map<string, ToolResult<unknown>>): ToolEvidence[] {
  return Array.from(fetched.entries()).map(([key, result]) => {
    const at = key.indexOf(":");
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(key.slice(at + 1)) as Record<string, unknown>;
    } catch {
      input = {};
    }
    return { tool: key.slice(0, at), input, ok: result.ok, data: result.data };
  });
}

// --- "open the heatmap" / "show me Reliance" ----------------------------------

const CONTEXT_PREFIX = /^\[Context:[^\]]*\]\s*/;
const NAV_REQUEST =
  /^(?:please\s+|can you\s+|could you\s+)?(?:open|show(?:\s+me)?|go\s+to|take\s+me\s+to|navigate\s+to|bring\s+up|launch|where\s+(?:is|are|can\s+i\s+find))\s+(.+?)[\s?.!]*$/i;
/** These want an answer, not a page: "show me HDFC Bank news", "show TCS's P/E". */
const WANTS_ANSWER = /\b(?:news|price|chart|p\/e|pe|ratio|financials|results|earnings|performance|returns?|why|how|vs|versus|compare|dividend|history|analysis)\b|'s\b/i;

export type NavigationDeps = { runTool: (name: string, args: unknown) => Promise<ToolResult<unknown>> };

export async function answerNavigation(message: string, deps: NavigationDeps, conversationId: string): Promise<AgentResponse | null> {
  const text = message.replace(CONTEXT_PREFIX, "").trim();
  const request = text.match(NAV_REQUEST);
  if (!request) return null;
  const subject = request[1].trim();

  const page = pageFor(subject);
  if (page) {
    const name = page.label.replace(/^(?:Open|View)\s+/, "");
    return { answer: `Here's ${/^Your /.test(name) ? name.toLowerCase() : `the ${name}`} page.`, toolCalls: [], sources: [], warnings: [], conversationId, links: [pageLink(page.path, true)] };
  }

  if (WANTS_ANSWER.test(subject) || subject.length > 40 || subject.split(/\s+/).length > 5) return null;

  const query = subject.replace(/^(?:the\s+)?/i, "").replace(/\s+(?:stock|shares?|page)$/i, "");
  const result = await deps.runTool("resolve_symbol", { query });
  const trace: AgentToolCallTrace = { tool: "resolve_symbol", input: { query }, ok: result.ok, source: result.source };
  const best = (result.data as { bestMatch?: { symbol?: string; name?: string } } | null)?.bestMatch;
  if (!result.ok || !best?.symbol) return null;

  // Only link when the match plainly is what was asked for — never a guess.
  const first = query.toLowerCase().split(/\s+/)[0];
  const haystack = `${best.symbol} ${best.name ?? ""}`.toLowerCase();
  if (first.length < 2 || !haystack.includes(first)) return null;

  const path = stockPath(best.symbol);
  if (!path) return null;
  const name = best.name ? titleCase(best.name) : path.slice(7);
  return {
    answer: `Here's **${name}** (${path.slice(7)}) on StockSphere: live price, chart, key stats and news.`,
    toolCalls: [trace],
    sources: [result.source],
    warnings: [],
    conversationId,
    links: [{ label: `Open ${name}`, href: path, kind: "internal", primary: true }],
  };
}
