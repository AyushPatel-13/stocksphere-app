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

function matches(value: number, data: number[]): boolean {
  const target = Math.abs(value);
  return data.some((d) => {
    const ref = Math.abs(d);
    if (Math.abs(target - ref) <= 0.051) return true;
    if (ref > 0 && Math.abs(target - ref) / ref <= 0.005) return true;
    // Scaled display: ₹16.10 L Cr from 16103642434460, or 4.67 lakh crore.
    for (const scale of [1e5, 1e7, 1e9, 1e12, 1e3, 1e6]) {
      if (ref > 0 && Math.abs(target * scale - ref) / ref <= 0.006) return true;
    }
    return false;
  });
}

export function scoreGrounding(answer: string, toolData: string[]): GroundingScore {
  const data = toolData.flatMap(numbersIn);
  const claims = claimText(answer);
  const ungrounded: string[] = [];
  let checked = 0;
  for (const m of claims.matchAll(/-?\d+(?:,\d{2,3})*(?:\.\d+)?/g)) {
    const value = Number(m[0].replace(/,/g, ""));
    if (!Number.isFinite(value) || !isDataFigure(value, m[0])) continue;
    checked++;
    if (!matches(value, data)) ungrounded.push(m[0]);
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
