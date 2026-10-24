import { z } from "zod";

import { ToolDefinition, okResult } from "../types";

/**
 * Exchange and SEBI mechanics that general-purpose models tend to get vague
 * or wrong (a production answer called the F&O ban a regulator's response to
 * "market manipulation concerns"). Rules only — no live lists or figures that
 * change daily; the entries say where those are published.
 */

const SOURCE = "StockSphere market glossary (exchange/SEBI rules; general information)";

export const GLOSSARY = {
  fo_ban:
    "F&O ban period (NSE): a stock enters the ban when market-wide open interest in its futures and options exceeds 95% of its market-wide position limit (MWPL). During the ban no fresh F&O positions may be created — traders may only reduce or close existing positions, and increasing one can draw a penalty. The stock leaves the ban once open interest falls below 80% of MWPL. Cash-market (delivery/intraday equity) trading is not affected. NSE publishes the list daily; the current list comes from get_fo_ban_list.",
  circuit_limits:
    "Price bands / circuits: exchanges set a daily price band for most stocks (commonly 2%, 5%, 10% or 20%); a stock at its upper or lower band is 'in circuit' and trades only at that price until the band allows otherwise. Stocks in the F&O segment have no fixed band but dynamic price bands that the exchange can widen. Separately, index-wide circuit breakers halt all equity trading when the Nifty 50 or Sensex moves 10%, 15% or 20%.",
  settlement:
    "Settlement: Indian equities settle T+1 (one working day after the trade) since January 2023. An optional same-day (T+0) cycle exists for a limited set of stocks. US equities settle T+1 since May 2024.",
  asm_gsm:
    "ASM / GSM: exchanges' Additional Surveillance Measure and Graded Surveillance Measure frameworks flag stocks with unusual price or volume moves or concerns about fundamentals. Measures by stage can include higher margins (up to 100%), trade-for-trade settlement and limits on trading frequency. The exchanges publish the current lists.",
  ipo_allotment:
    "IPO allotment (mainboard): investors bid in lots within the price band. Categories: retail individual investors (bids up to ₹2 lakh), non-institutional investors (above ₹2 lakh) and qualified institutional buyers; for most issues at least 35% is reserved for retail. When the retail portion is oversubscribed, allotment is by computerised lottery so as many applicants as possible get the minimum lot — most get nothing in a heavily oversubscribed issue. Allotment status is on the registrar's and exchange websites.",
  gmp:
    "Grey market premium (GMP): an unofficial, unregulated premium at which IPO shares or applications are informally traded before listing. It is not recognised by SEBI or the exchanges, can change quickly and often fails to predict the listing price. StockSphere does not show GMP.",
  sme_ipo:
    "SME IPOs list on NSE Emerge or BSE SME. Issues are smaller, liquidity is usually lower, lot sizes are larger and disclosure and eligibility rules differ from the main board, so risk is generally higher.",
  lot_size:
    "Lot size: the minimum number of shares per IPO application (and multiples of it), or the fixed contract size of a futures/options contract set by the exchange.",
} as const;

type Term = keyof typeof GLOSSARY;
const TERMS = Object.keys(GLOSSARY) as Term[];

/**
 * What a model might send for each entry. Free text is accepted and matched
 * here, because a strict enum turned "F&O ban" into a bare validation failure
 * that the model then reported as "no entry defining F&O ban".
 */
const ALIASES: Record<Term, RegExp> = {
  fo_ban: /\b(?:f\s*&\s*o|f\s*and\s*o|fno|futures\s*(?:and|&)\s*options|derivatives?)\b.*\bban\b|\bban\s*(?:list|period)\b|\bmwpl\b|^fo_?ban$/i,
  circuit_limits: /\bcircuits?\b|\bprice\s*bands?\b|^circuit_limits$/i,
  settlement: /\bsettlement\b|\bt\s*\+\s*[01]\b/i,
  asm_gsm: /\basm\b|\bgsm\b|\bsurveillance\b|^asm_gsm$/i,
  ipo_allotment: /\ballot(?:ment|ted)\b|^ipo_allotment$/i,
  gmp: /\bgmp\b|\bgrey\s*market\b/i,
  sme_ipo: /\bsme\b/i,
  lot_size: /\blot\s*size\b|^lot_size$/i,
};

export function matchTerm(raw: string): Term | null {
  const text = raw.trim();
  if ((TERMS as string[]).includes(text)) return text as Term;
  return TERMS.find((term) => ALIASES[term].test(text)) ?? null;
}

const argsSchema = z.object({ term: z.string().trim().min(1).max(80) });

export type GlossaryArgs = z.infer<typeof argsSchema>;

type GlossaryResult =
  | { found: true; term: Term; explanation: string }
  | { found: false; asked: string; known: Term[]; guidance: string };

export const glossaryTool: ToolDefinition<GlossaryArgs, GlossaryResult> = {
  name: "get_market_term",
  description:
    "Exact rules for Indian market mechanics: fo_ban (F&O ban period), circuit_limits, settlement (T+1), asm_gsm (surveillance), ipo_allotment, gmp, sme_ipo, lot_size. Use it before explaining any of these; for other concepts answer from general knowledge.",
  parameters: {
    type: "object",
    properties: { term: { type: "string", description: `The term to explain, e.g. one of: ${TERMS.join(", ")}.` } },
    required: ["term"],
  },
  argsSchema,
  async execute({ term }) {
    const match = matchTerm(term);
    if (match) return okResult({ found: true, term: match, explanation: GLOSSARY[match] }, SOURCE);
    // Not an error: the glossary only holds rules models tend to get wrong.
    return okResult(
      {
        found: false,
        asked: term,
        known: TERMS,
        guidance: "Not in StockSphere's glossary. That says nothing about the concept: explain it from general knowledge under a \"General information\" label.",
      },
      SOURCE
    );
  },
};
