/**
 * Which questions get a research workflow instead of the open tool loop.
 *
 * A workflow fetches everything it needs on the server in parallel and makes a
 * single model call with no tool definitions attached, so it costs a fraction
 * of the tokens of a multi-round tool conversation (Groq's free tier allows
 * 8,000 a minute, which a four-round research question used to exceed).
 *
 * Only unambiguous phrasings match; everything else — follow-ups, concepts,
 * index questions — stays with the tool loop, which can ask for clarification.
 */

export type Workflow =
  | { type: "research"; query: string }
  | { type: "explain_move"; query: string }
  | { type: "compare"; queries: string[] }
  | { type: "portfolio" };

export const WORKFLOW_TYPES = ["research", "explain_move", "compare", "portfolio"] as const;

/** Things that aren't one company: these questions belong to the tool loop. */
const NOT_A_COMPANY =
  /^(?:the\s+)?(?:market|markets|stock market|indian market|us market|nifty(?:\s*50)?|sensex|bank\s*nifty|s&p(?:\s*500)?|nasdaq|dow(?:\s+jones)?|gold|silver|crude|oil|bitcoin|btc|crypto|rupee|dollar|it|it stocks|banks?|pharma|everything|stocks|shares)$/i;

const MOVE_WORDS =
  "up|down|rise|rising|risen|rose|fall|falling|fallen|fell|drop|dropping|dropped|jump|jumped|jumping|surge|surged|surging|crash|crashed|crashing|move|moved|moving|rall(?:y|ied|ying)|slump(?:ed)?|tank(?:ed)?|soar(?:ed)?|plunge[d]?|go(?:ing)? (?:up|down)|went (?:up|down)";

function clean(name: string): string | null {
  const value = name
    .replace(/\b(?:stock|stocks|shares?|share price|ltd\.?|limited)\b/gi, " ")
    .replace(/\s+(?:today|yesterday|this week|last week|on \w+day|recently|so much|in detail|for me)$/i, "")
    .replace(/[?.!,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (value.length < 2 || value.length > 60 || NOT_A_COMPANY.test(value)) return null;
  return value;
}

/** The stock page prefixes questions with this (lib/agent/client/contract.ts). */
const CONTEXT_PREFIX = /^\[Context: user is viewing ([^;\]]{1,30});[^\]]*\]\s*/;

export function detectWorkflow(message: string): Workflow | null {
  let text = message.trim();
  const context = text.match(CONTEXT_PREFIX);
  if (context) {
    const viewing = context[1].trim();
    text = text.slice(context[0].length).replace(/\b(?:this stock|this company|this share|it)\b/gi, viewing);
  }
  if (!text || text.length > 200) return null;

  if (
    /\b(?:analy[sz]e|review|check|assess|summari[sz]e|evaluate|break ?down|look at)\b[^.?!]*\bmy\s+(?:portfolio|holdings|investments)\b/i.test(text) ||
    /^(?:how (?:is|are)|how's)\s+my\s+(?:portfolio|holdings|investments)\b/i.test(text)
  ) {
    return { type: "portfolio" };
  }

  const compare =
    text.match(/^\s*compare\s+(.+?)\s+(?:and|with|vs\.?|versus|to|against)\s+(.+?)[\s?.!]*$/i) ??
    text.match(/^\s*([\w .&'-]{2,40}?)\s+(?:vs\.?|versus)\s+([\w .&'-]{2,60}?)[\s?.!]*$/i);
  if (compare) {
    const names = [compare[1], ...compare[2].split(/\s*(?:,|\band\b|\bvs\.?)\s*/i)]
      .map((n) => clean(n))
      .filter((n): n is string => n !== null);
    const unique = Array.from(new Set(names.map((n) => n.toLowerCase()))).map((lower) => names.find((n) => n.toLowerCase() === lower)!);
    if (unique.length >= 2 && unique.length <= 3) return { type: "compare", queries: unique };
    return null;
  }

  const move = text.match(new RegExp(`\\bwhy\\s+(?:did|is|has|was|are|were|does|do)\\s+(.+?)\\s+(?:stock\\s+|shares?\\s+|share price\\s+)?(?:${MOVE_WORDS})\\b`, "i"));
  if (move) {
    const query = clean(move[1]);
    return query ? { type: "explain_move", query } : null;
  }

  const research = text.match(
    /^\s*(?:please\s+)?(?:research|analy[sz]e|deep[- ]dive(?:\s+(?:into|on))?|(?:give me|write|do|make)\s+(?:a\s+)?(?:full\s+|detailed\s+)?(?:research(?:\s+report)?|analysis|report|research note)\s+(?:on|of|for|about))\s+(.+?)[\s?.!]*$/i
  );
  if (research) {
    const query = clean(research[1]);
    return query ? { type: "research", query } : null;
  }

  return null;
}
