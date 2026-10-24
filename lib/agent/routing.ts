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

export function toolsFor(message: string, all: ToolDefinition[] = AGENT_TOOLS): ToolDefinition[] {
  if (isConceptQuestion(message)) {
    return all.filter((tool) => (CONCEPT_TOOL_NAMES as readonly string[]).includes(tool.name));
  }
  // An index move gets index levels and breadth; get_news takes a stock symbol and returns nothing for "NIFTY".
  if (isIndexMoveQuestion(message)) return all.filter((tool) => tool.name !== "get_news");
  return all;
}
