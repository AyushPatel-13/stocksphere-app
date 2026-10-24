import { getFoBanList, type FoBanList } from "@/lib/apis/nseFoBan";
import type { AgentResponse } from "@/lib/types/agent";
import { buildLinks, type ToolEvidence } from "./navigation";
import { foBanIntent } from "./routing";
import { createFoBanTool } from "./tools/foBanTool";
import { GLOSSARY } from "./tools/glossaryTool";

/**
 * F&O ban questions, answered without a model call.
 *
 * "What is F&O ban?" gets the glossary's explanation; "Which stocks are in
 * the F&O ban today?" gets NSE's ban-period file, with its trade date checked
 * against today. When the file can't be fetched the answer says so and still
 * explains the ban — it never lists a security it didn't read from NSE. Every
 * answer links NSE's official page (lib/agent/navigation.ts).
 *
 * "Is SAIL in the ban?" returns null here and goes to the model, which is
 * offered only the ban list and the glossary (lib/agent/routing.ts).
 */

export type FoBanDeps = { loadList?: () => Promise<FoBanList | null>; now?: () => number };

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// The glossary entry without its internal tool name.
const EXPLANATION = GLOSSARY.fo_ban.replace(/\s*[^.]*\bget_[a-z_]+\b[^.]*\.?/g, "").trim();

const MWPL =
  "MWPL (market-wide position limit) is the most open interest the exchange allows in a stock's futures and options, added up across everyone in the market. NSE sets it for each F&O stock and reviews it periodically; it is the yardstick for the ban.";

const OFFICIAL_POINTER =
  "NSE publishes the securities in the ban period every day; the file is for the next trade date, so check the date on it. Use **Check Today's NSE F&O Ban List** below for the official list.";

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export async function answerFoBan(message: string, deps: FoBanDeps, conversationId: string): Promise<AgentResponse | null> {
  const intent = foBanIntent(message);
  if (intent !== "concept" && intent !== "list") return null;
  const asksMwpl = /\bmwpl\b|market[- ]wide position limit/i.test(message);

  if (intent === "concept") {
    const parts = asksMwpl ? [MWPL, `**F&O ban period**: ${EXPLANATION}`] : [EXPLANATION];
    return {
      answer: [`**General information**`, ...parts, OFFICIAL_POINTER].join("\n\n"),
      toolCalls: [],
      sources: ["StockSphere glossary"],
      warnings: [],
      conversationId,
      links: buildLinks(message, []),
    };
  }

  const tool = createFoBanTool(deps.loadList ?? (() => getFoBanList()));
  const result = await tool.execute({});
  const calls: ToolEvidence[] = [{ tool: tool.name, input: {}, ok: result.ok, data: result.data }];
  const response = {
    toolCalls: [{ tool: tool.name, input: {}, ok: result.ok, source: result.source }],
    sources: [result.source],
    conversationId,
    links: buildLinks(message, calls),
  };

  if (!result.ok || !result.data) {
    return {
      ...response,
      answer: [
        "I couldn't fetch NSE's ban-period file just now, so I can't say which stocks are in the F&O ban — I won't guess at the list.",
        `**What the F&O ban is**\n\n${EXPLANATION}`,
        "The official list is on NSE's page, linked below; its file is for the next trade date.",
      ].join("\n\n"),
      warnings: ["NSE's F&O ban file couldn't be fetched, so the current list isn't shown."],
    };
  }

  const { tradeDate, securities } = result.data;
  const today = new Date((deps.now ?? Date.now)() + IST_OFFSET_MS).toISOString().slice(0, 10);
  const warnings = tradeDate < today ? [`NSE's latest ban file is for ${formatDate(tradeDate)}, before today (${formatDate(today)}); NSE may not have published today's file yet.`] : [];
  const list = securities.length
    ? `| # | Security |\n|---|---|\n${securities.map((symbol, index) => `| ${index + 1} | ${symbol} |`).join("\n")}`
    : "NSE's file lists **no securities** in the ban period for that date.";

  return {
    ...response,
    answer: [
      `**Securities in the F&O ban for trade date ${formatDate(tradeDate)}** — from NSE's ban-period file:`,
      list,
      "While a stock is in the ban, no fresh F&O positions may be opened in it — only existing ones reduced or closed. Cash-market (delivery/intraday) trading in it is unaffected.",
      `Source: NSE, fo_secban.csv (fetched ${new Date(result.fetchedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST).`,
    ].join("\n\n"),
    warnings,
  };
}
