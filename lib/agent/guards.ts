import { numbersIn } from "./benchmark/score";

/**
 * Deterministic checks on AI answers, for the two mistakes the October 2026
 * provider benchmark caught that instructions alone didn't prevent:
 *
 *   1. Market cap in the wrong unit — Reliance's ₹16.10 lakh crore written as
 *      "₹16,103.6 Cr", 100× too small.
 *   2. Comparison figures from memory — "Nifty IT P/E around 20–22", "Nifty
 *      average dividend yield ~3.5%" — that no tool had returned.
 *
 * Both run after the model answers, against the data it was actually given.
 */

// --- 1. Market cap units ---------------------------------------------------

export type MarketCapRef = { value: number; display: string | null };

const UNIT_SCALE: [RegExp, number][] = [
  [/^(?:l(?:akh)?\.?\s*cr(?:ore)?s?|lakh\s+crores?)$/i, 1e12],
  [/^(?:cr(?:ore)?s?)$/i, 1e7],
  [/^(?:tn|trn|trillion|t)$/i, 1e12],
  [/^(?:bn|billion|b)$/i, 1e9],
  [/^(?:mn|million|m)$/i, 1e6],
];

const AMOUNT =
  /((?:₹|Rs\.?\s?|INR\s?|US\$\s?|\$)?)(\d[\d,]*(?:\.\d+)?)\s*(L(?:akh)?\.?\s*Cr(?:ore)?s?|lakh\s+crores?|crores?|Cr|trillion|trn|tn|billion|bn|million|mn|[TBM])\b/gi;

const MARKET_CAP_LINE = /market[\s‐-―-]*cap/i;

function scaleOf(unit: string): number | null {
  const found = UNIT_SCALE.find(([pattern]) => pattern.test(unit.trim()));
  return found ? found[1] : null;
}

/**
 * Checks every amount on a line that talks about market cap against the
 * market caps in the evidence. A figure that matches none of them (allowing
 * 1.5% for rounding) is wrong: with one company it is replaced by that
 * company's display value; with several it is marked as unverified, since
 * we can't tell which company it was meant for.
 */
export function verifyMarketCaps(answer: string, refs: MarketCapRef[]): { answer: string; corrected: number; flagged: number } {
  const usable = refs.filter((r) => Number.isFinite(r.value) && r.value > 0);
  if (usable.length === 0) return { answer, corrected: 0, flagged: 0 };
  let corrected = 0;
  let flagged = 0;

  const lines = answer.split("\n").map((line) => {
    if (!MARKET_CAP_LINE.test(line)) return line;
    return line.replace(AMOUNT, (whole, _prefix: string, digits: string, unit: string) => {
      const scale = scaleOf(unit);
      if (scale === null) return whole;
      const value = Number(digits.replace(/,/g, "")) * scale;
      if (usable.some((r) => Math.abs(value - r.value) / r.value <= 0.015)) return whole;
      if (usable.length === 1 && usable[0].display) {
        corrected++;
        return usable[0].display;
      }
      flagged++;
      return `${whole} (unverified: doesn't match the source)`;
    });
  });

  return { answer: lines.join("\n"), corrected, flagged };
}

/** Market caps in tool results: { marketCap, marketCapDisplay } objects at any depth. */
export function marketCapRefs(data: unknown): MarketCapRef[] {
  const refs: MarketCapRef[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(visit);
    const record = value as Record<string, unknown>;
    if (typeof record.marketCap === "number") {
      refs.push({ value: record.marketCap, display: typeof record.marketCapDisplay === "string" ? record.marketCapDisplay : null });
    }
    Object.values(record).forEach(visit);
  };
  visit(data);
  return refs;
}

// --- 2. Comparison figures from memory ------------------------------------

const BENCHMARK_WORDS = /\b(?:average|avg\.?|median|benchmark|typical(?:ly)?|industry|sector|peers?|index'?s?|nifty(?:\s+\w+)?|sensex|s&p|market)\b/i;
const METRIC_WORDS = /\b(?:p\/e|pe ratio|price[-\s]to[-\s]earnings|p\/b|dividend yield|yield|roe|roce|ev\/ebitda|multiple|valuation)\b/i;

/**
 * Sentences (or table rows) that compare with an index, sector or average
 * valuation figure that isn't in the data the model was given. Returns the
 * offending numbers with a little context, for a visible note.
 */
export function findUnsourcedComparisons(answer: string, dataTexts: string[]): string[] {
  const data = dataTexts.flatMap(numbersIn).map(Math.abs);
  const inData = (n: number) => data.some((d) => Math.abs(d - n) <= 0.051 || (d > 0 && Math.abs(d - n) / d <= 0.005));
  const found: string[] = [];

  const body = answer.split(/\n\*\*Sources\*\*/)[0];
  for (const sentence of body.split(/(?<=[.!?])\s+|\n/)) {
    if (!BENCHMARK_WORDS.test(sentence) || !METRIC_WORDS.test(sentence)) continue;
    // Only the clause after the benchmark word: "P/E 17.6 vs the Nifty IT index's ~20" → "~20".
    const at = sentence.search(BENCHMARK_WORDS);
    const tail = sentence.slice(at).replace(/\[\[?\d+\]\]?(?:\([^)]*\))?/g, " ");
    for (const m of tail.matchAll(/\d+(?:\.\d+)?/g)) {
      const n = Number(m[0]);
      if (Number.isInteger(n) && n >= 1990 && n <= 2035) continue; // years
      if (/^\d{2}$/.test(m[0]) && /nifty\s*$/i.test(tail.slice(0, m.index))) continue; // "Nifty 50"
      if (/^(?:50|100|500)$/.test(m[0])) continue; // index names: Nifty 50, S&P 500, Nasdaq 100
      // A price move ("the Nifty fell 0.39%") isn't a valuation benchmark.
      if (/\b(?:fell|rose|gained|lost|up|down|declined|climbed|dropped|jumped|slipped|added|moved)\s+(?:by\s+)?[~≈-]?\s*$/i.test(tail.slice(0, m.index))) continue;
      if (!inData(n)) found.push(sentence.trim().slice(0, 120));
    }
  }
  return Array.from(new Set(found));
}

export const UNSOURCED_NOTE =
  "_Note: a comparison figure above (an index, sector or average value) wasn't in the data StockSphere fetched. Treat it as unverified._";
