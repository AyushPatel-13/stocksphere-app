/**
 * Deterministic scoring for the AI provider benchmark (scripts/ai-benchmark.ts).
 *
 * Grounding is checked against the exact tool results the model was shown:
 * every figure in an answer must appear in that data (allowing for rounding).
 * Figures that aren't data — list numbers, years, citation markers — are
 * ignored, so a "3 questions to research" never counts as a hallucination.
 */

export type GroundingScore = {
  checked: number;
  grounded: number;
  ungrounded: string[];
};

/** All numbers in a block of tool-result JSON or text. */
export function numbersIn(text: string): number[] {
  return Array.from(text.matchAll(/-?\d+(?:,\d{2,3})*(?:\.\d+)?/g))
    .map((m) => Number(m[0].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
}

/** The answer text that makes claims: no Sources list, links or citation markers. */
export function claimText(answer: string): string {
  return answer
    .split(/\n\*\*Sources\*\*/)[0]
    .replace(/\[\[\d+\]\]\([^)]*\)/g, " ")
    .replace(/\[\d+\]/g, " ")
    .replace(/\]\(https?:[^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\bQ[1-4]\s*FY\s*\d{2,4}\b/gi, " ")
    .replace(/\bFY\s*\d{2,4}\b/gi, " ");
}

function isDataFigure(value: number, raw: string): boolean {
  if (Number.isInteger(value) && Math.abs(value) <= 10 && !raw.includes(".")) return false; // list numbers, "3 questions"
  if (Number.isInteger(value) && value >= 1990 && value <= 2035) return false; // years
  return true;
}

/** A figure and, when one follows it, its unit: "16.10 L Cr", "49,244 crore", "3.2 bn". */
const FIGURE = /-?\d+(?:,\d{2,3})*(?:\.\d+)?(?:\s*(L(?:akh)?\.?\s*Cr(?:ore)?s?|lakh\s+crores?|crores?|Cr|trillion|trn|tn|billion|bn|million|mn)\b)?/gi;

function unitScale(unit: string | undefined): number {
  if (!unit) return 1;
  const u = unit.trim().toLowerCase();
  if (/^l(akh)?\.?\s*cr|^lakh\s+crore/.test(u)) return 1e12;
  if (/^cr/.test(u)) return 1e7;
  if (/^(trillion|trn|tn)$/.test(u)) return 1e12;
  if (/^(billion|bn)$/.test(u)) return 1e9;
  return 1e6;
}

/** Every value in the data: plain numbers, plus the scaled value of any number with a unit. */
function dataValues(texts: string[]): number[] {
  const values: number[] = [];
  for (const text of texts) {
    for (const m of text.matchAll(FIGURE)) {
      const plain = Number(m[0].match(/-?\d+(?:,\d{2,3})*(?:\.\d+)?/)![0].replace(/,/g, ""));
      if (!Number.isFinite(plain)) continue;
      values.push(plain);
      if (m[1]) values.push(plain * unitScale(m[1]));
    }
  }
  return values;
}

function near(target: number, values: number[], relative: number): boolean {
  return values.some((d) => {
    const ref = Math.abs(d);
    return Math.abs(target - ref) <= 0.051 || (ref > 0 && Math.abs(target - ref) / ref <= relative);
  });
}

/**
 * A figure with a unit must match the data at that scale, so "₹16,103.6 Cr"
 * for a ₹16.10 lakh crore company is caught (it once passed when any scale
 * was accepted); a bare figure must match a plain number.
 */
export function scoreGrounding(answer: string, toolData: string[]): GroundingScore {
  const data = dataValues(toolData);
  const claims = claimText(answer);
  const ungrounded: string[] = [];
  let checked = 0;
  for (const m of claims.matchAll(FIGURE)) {
    const raw = m[0].match(/-?\d+(?:,\d{2,3})*(?:\.\d+)?/)![0];
    const value = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(value) || (!m[1] && !isDataFigure(value, raw))) continue;
    checked++;
    const ok = m[1] ? near(Math.abs(value) * unitScale(m[1]), data, 0.006) : near(Math.abs(value), data, 0.005);
    if (!ok) ungrounded.push(m[0].trim());
  }
  return { checked, grounded: checked - ungrounded.length, ungrounded };
}

export type Expectation = {
  /** Tools the answer must have used (tool-loop questions). */
  tools?: string[];
  /** Phrases the answer must contain (case-insensitive regex sources). */
  mustMatch?: string[];
  /** Phrases it must not contain. */
  mustNotMatch?: string[];
};

export function checkExpectations(answer: string, toolsUsed: string[], expect: Expectation): string[] {
  const failures: string[] = [];
  for (const tool of expect.tools ?? []) if (!toolsUsed.includes(tool)) failures.push(`didn't use ${tool}`);
  for (const pattern of expect.mustMatch ?? []) if (!new RegExp(pattern, "i").test(answer)) failures.push(`missing /${pattern}/`);
  for (const pattern of expect.mustNotMatch ?? []) if (new RegExp(pattern, "i").test(answer)) failures.push(`contains /${pattern}/`);
  return failures;
}
