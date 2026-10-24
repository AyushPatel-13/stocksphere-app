import { AGENT_TOOLS } from "./tools";
import type { ToolDefinition } from "./types";

/**
 * Which tools a question is offered.
 *
 * A general education question — "What is the F&O ban?", "What is the P/E
 * ratio?" — needs no live data, only the glossary of exchange rules (and the
 * app guide). Offering it the news, price and company tools invited the
 * model to look the concept up as if it were a stock and then report "no data
 * defining F&O ban". So such questions get only those two tools: the model can
 * still check exact rules, but can't send a concept to the news service.
 *
 * Anything time-sensitive ("today", "current", "which stocks…", a price or
 * a named company's figure) keeps the full tool set.
 */

export const CONCEPT_TOOL_NAMES = ["get_market_term", "get_app_help"] as const;

const CONTEXT_PREFIX = /^\[Context:[^\]]*\]\s*/;

const CONCEPT_LEAD =
  /^(?:what(?:'s| is| are| does| do)|whats|define|definition of|meaning of|explain|how (?:does|do|is|are)|difference between|what happens (?:when|if|in|during)|why (?:do|does|are|is) (?:companies|stocks|investors|traders|people|markets?|banks|ipos?|shares)\b|can you explain|tell me about (?:the )?concept)/i;

/** Words that make a question about now, not about a concept. */
const TIME_SENSITIVE =
  /\b(?:today|todays|today's|now|currently|current|latest|right now|this (?:week|month|year)|yesterday|live|price of|trading at|list|which stocks|which shares|banned stocks|in (?:the )?ban\b|is .+ in (?:the )?(?:f&o )?ban|how much|how is .+ doing|performance|returns? of|news)\b/i;

/** Finance acronyms that don't name a company. */
const ACRONYMS = new Set([
  "P/E", "PE", "EPS", "ROE", "ROA", "ROCE", "IPO", "IPOS", "SIP", "SIPS", "ETF", "ETFS", "F&O", "FNO", "NAV", "GMP", "MWPL", "SEBI", "NSE", "BSE",
  "ASM", "GSM", "T+1", "EV", "EBITDA", "EV/EBITDA", "CAGR", "XIRR", "PB", "P/B", "PEG", "FII", "FIIS", "DII", "DIIS", "NIFTY", "SENSEX", "OI",
  "SME", "RHP", "DRHP", "AMC", "MF", "MFS", "ELSS", "PPF", "NPS", "FD", "FDS", "LTCG", "STCG", "GST", "TDS", "KYC", "DEMAT", "US", "UK", "RBI",
  "NRI", "HNI", "QIB", "RII", "NII", "OFS", "FPO", "ESOP", "ESOPS", "ADR", "GDR", "REIT", "REITS", "INVIT", "INVITS", "CE", "PE'S", "VIX", "IV",
]);

/**
 * The question has to be about a finance concept: "what is tcs" names a
 * company, not a concept, and needs the company tools.
 */
const FINANCE_TERM =
  /\b(?:ratio|ban|settlement|circuits?|ipos?|sips?|etfs?|mutual funds?|dividends?|yield|bonds?|options?|futures?|derivatives?|margin|leverage|stop[- ]loss|p\/e|p\/b|pe ratio|eps|roe|roa|roce|ebitda|market cap(?:italisation|italization)?|valuation|inflation|interest rates?|repo rate|index|indices|stock split|bonus|buyback|demat|brokers?|short selling|intraday|delivery|f&o|fno|gmp|grey market|allotment|lot size|asm|gsm|nav|cagr|xirr|expense ratio|fundamental|technical analysis|candlesticks?|moving average|rsi|macd|volatility|beta|alpha|hedg\w*|portfolio|diversification|asset allocation|tax\w*|ltcg|stcg|capital gains|free float|face value|book value|liquidity|bull|bear|correction|recession|gdp|fiis?|diis?|sebi|rbi|t\+1|lump sum|compounding|annuit\w*|debt|equity|reits?|invits?|esops?|ofs|fpo|rights issue|record date|ex[- ]?(?:date|dividend)|market order|limit order|arbitrage|spread|premium|strike price|expiry|open interest|mwpl|vix|upper circuit|lower circuit|sme|rhp|drhp|qib|anchor investors?|subscription|listing gains?|sensex|nifty|stock market|share market|trading|investing|shares?|stocks?)\b/i;

/** "Why did the Nifty fall?" — an index move, which the news tool (stock symbols only) can't explain. */
const INDEX_MOVE =
  /\b(?:nifty(?:\s*50)?|sensex|bank\s*nifty|the market|markets|s&p(?:\s*500)?|nasdaq|dow)\b[^?]*\b(?:fall|fell|falling|drop|dropped|down|crash\w*|decline\w*|slump\w*|rise|rose|rising|up|rall\w*|jump\w*|surge\w*|move\w*|gain\w*)\b/i;

export function isIndexMoveQuestion(message: string): boolean {
  return INDEX_MOVE.test(message.replace(CONTEXT_PREFIX, ""));
}

export function isConceptQuestion(message: string): boolean {
  const text = message.replace(CONTEXT_PREFIX, "").trim();
  if (!text || text.length > 200 || !CONCEPT_LEAD.test(text) || TIME_SENSITIVE.test(text) || !FINANCE_TERM.test(text)) return false;
  // A named company or ticker ("What is TCS's P/E?", "What is the P/E of Infosys?") needs data.
  if (/\b(?:of|for)\s+[A-Z][A-Za-z&.]{1,}/.test(text.replace(/^[^ ]+\s/, ""))) return false;
  if (/\b[A-Z][A-Za-z]+['’]s\b/.test(text)) return false;
  for (const token of text.match(/\b[A-Z][A-Z0-9&/+.]{1,}\b/g) ?? []) {
    if (!ACRONYMS.has(token.replace(/\.$/, ""))) return false;
  }
  return true;
}

// --- the F&O ban -------------------------------------------------------------

const FNO = String.raw`(?:f\s*&\s*o|f\s*(?:and|n)\s*o|fno|futures\s*(?:and|&)\s*options|derivatives?)`;

/**
 * Any question about NSE's F&O ban, however it's worded: "F&O ban", "f and o
 * ban in stocks in india", "futures and options ban", "NSE ban list", "stocks
 * in ban period", "MWPL".
 */
export const FO_BAN_QUESTION = new RegExp(
  [
    String.raw`\b${FNO}\b[^?]*\bban(?:ned)?\b`,
    String.raw`\bban(?:ned)?\b[^?]*\b${FNO}\b`,
    String.raw`\b(?:nse|securities|stocks?|shares?|scrips?)\s+(?:in\s+(?:the\s+)?)?ban\b`,
    String.raw`\bban\s*(?:list|period)\b`,
    String.raw`\bmwpl\b`,
    String.raw`\bmarket[- ]wide position limits?\b`,
  ].join("|"),
  "i"
);

/** Asks which securities are in the ban now. */
const CURRENT_BAN =
  /\b(?:today|todays|today's|tomorrow|now|currently|current|latest|right now|this week|list|which|what (?:stocks|shares|securities)|banned\b[^?]*\b(?:stocks|shares|securities|scrips)|(?:stocks|shares|securities|scrips) (?:in|under))\b/i;

/** Asks about one named stock: "Is SAIL in the F&O ban?" */
const ONE_STOCK = /\bis\s+(?!it\b|there\b|the\b|a\b|any\b)[A-Za-z][A-Za-z&.-]*\s+(?:in|under|banned)\b/i;

export type FoBanIntent = "concept" | "list" | "stock";

/**
 * What an F&O ban question wants — or null when it isn't one.
 *
 * "concept" (what the ban is) and "list" (which securities are in it) are
 * answered by lib/agent/foBan.ts without a model call. "stock" ("Is SAIL in
 * the ban?") goes to the model with only the ban list and glossary. None of
 * them is offered a company tool: "f and o ban in stocks in india" was read
 * as Ford (F) and Occidental (O) when it was.
 */
export function foBanIntent(message: string): FoBanIntent | null {
  const text = message.replace(CONTEXT_PREFIX, "").trim();
  if (!text || text.length > 200 || !FO_BAN_QUESTION.test(text)) return null;
  if (ONE_STOCK.test(text)) return "stock";
  return CURRENT_BAN.test(text) ? "list" : "concept";
}

/** "F&O ban", "tell me about F&O ban", "What is MWPL?" — the ban as a concept. */
export function isFoBanConceptQuestion(message: string): boolean {
  return foBanIntent(message) === "concept";
}

// --- abbreviations that aren't tickers -----------------------------------------

const ABBREVIATIONS: Array<{ pattern: RegExp; letters: string[]; name: string }> = [
  { pattern: /\bf\s*(?:&|and|n)\s*o\b|\bfno\b/i, letters: ["F", "O", "FO", "FNO"], name: "F&O (futures and options)" },
  { pattern: /\bp\s*\/\s*e\b/i, letters: ["P", "E"], name: "P/E (price-to-earnings)" },
  { pattern: /\bp\s*\/\s*b\b/i, letters: ["P", "B"], name: "P/B (price-to-book)" },
];

/**
 * The abbreviation a symbol argument was cut from, if any: in "f and o ban",
 * F and O are futures and options, not Ford and Occidental. "Show me Ford
 * stock" has no such abbreviation, so F stays a ticker there.
 */
export function abbreviationTicker(message: string, args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const values = Object.entries(args as Record<string, unknown>)
    .filter(([key]) => /^(?:symbol|symbols|query|names?|tickers?)$/i.test(key))
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toUpperCase().replace(/\.(?:NS|BO|US)$/, ""));
  for (const { pattern, letters, name } of ABBREVIATIONS) {
    if (pattern.test(message) && values.some((value) => letters.includes(value))) return name;
  }
  return null;
}

export const FO_BAN_TOOL_NAMES = [...CONCEPT_TOOL_NAMES, "get_fo_ban_list"] as const;

export function toolsFor(message: string, all: ToolDefinition[] = AGENT_TOOLS): ToolDefinition[] {
  // Any F&O ban question: the ban list and the glossary, never a company or price tool.
  if (foBanIntent(message)) return all.filter((tool) => (FO_BAN_TOOL_NAMES as readonly string[]).includes(tool.name));
  if (isConceptQuestion(message)) {
    return all.filter((tool) => (CONCEPT_TOOL_NAMES as readonly string[]).includes(tool.name));
  }
  // An index move gets index levels and breadth; get_news takes a stock symbol and returns nothing for "NIFTY".
  if (isIndexMoveQuestion(message)) return all.filter((tool) => tool.name !== "get_news");
  return all;
}
