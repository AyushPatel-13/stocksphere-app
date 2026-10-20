import { z } from "zod";
import { ToolDefinition, failResult, okResult } from "../types";

/**
 * Deterministic arithmetic for the assistant. Language models round and slip
 * on percentages ("1,060 → 1,161.2 is +9.6%" — it is +9.55%), so every
 * return, change, ratio or average in an answer is computed here, from the
 * numbers other tools returned, and the result is what the model quotes.
 */

const SOURCE = "StockSphere Calculator";

const OPERATIONS = ["percent_change", "difference", "ratio", "sum", "average", "cagr", "min", "max"] as const;
export type CalculatorOperation = (typeof OPERATIONS)[number];

const argsSchema = z.object({
  operation: z.enum(OPERATIONS),
  /** Ordered inputs; see the tool description for what each operation reads. */
  values: z.array(z.number().finite()).min(1).max(500),
  /** Years, for cagr only. */
  years: z.number().finite().positive().max(200).optional(),
  /** Decimal places in `rounded` (default 2). */
  decimals: z.number().int().min(0).max(8).optional(),
});

export type CalculatorArgs = z.infer<typeof argsSchema>;

export type CalculatorResult = {
  operation: CalculatorOperation;
  inputs: number[];
  /** Full-precision result. */
  value: number;
  /** The figure to quote. */
  rounded: number;
  unit: "percent" | "number";
  formula: string;
};

export type CalculatorOutcome = { ok: true; result: CalculatorResult } | { ok: false; reason: string };

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function calculate(args: CalculatorArgs): CalculatorOutcome {
  const { operation, values } = args;
  const decimals = args.decimals ?? 2;
  const done = (value: number, unit: CalculatorResult["unit"], formula: string): CalculatorOutcome =>
    Number.isFinite(value)
      ? { ok: true, result: { operation, inputs: values, value, rounded: round(value, decimals), unit, formula } }
      : { ok: false, reason: "The result isn't a finite number." };

  const pair = () => (values.length === 2 ? [values[0], values[1]] : null);

  switch (operation) {
    case "percent_change": {
      const p = pair();
      if (!p) return { ok: false, reason: "percent_change needs exactly two values: [from, to]." };
      if (p[0] === 0) return { ok: false, reason: "Can't take a percentage change from zero." };
      return done(((p[1] - p[0]) / Math.abs(p[0])) * 100, "percent", "(to − from) ÷ |from| × 100");
    }
    case "difference": {
      const p = pair();
      if (!p) return { ok: false, reason: "difference needs exactly two values: [a, b]." };
      return done(p[1] - p[0], "number", "b − a");
    }
    case "ratio": {
      const p = pair();
      if (!p) return { ok: false, reason: "ratio needs exactly two values: [numerator, denominator]." };
      if (p[1] === 0) return { ok: false, reason: "Can't divide by zero." };
      return done(p[0] / p[1], "number", "numerator ÷ denominator");
    }
    case "sum":
      return done(values.reduce((a, b) => a + b, 0), "number", "Σ values");
    case "average":
      return done(values.reduce((a, b) => a + b, 0) / values.length, "number", "Σ values ÷ count");
    case "min":
      return done(Math.min(...values), "number", "smallest value");
    case "max":
      return done(Math.max(...values), "number", "largest value");
    case "cagr": {
      const p = pair();
      if (!p || !args.years) return { ok: false, reason: "cagr needs two values [start, end] and years." };
      if (p[0] <= 0 || p[1] <= 0) return { ok: false, reason: "cagr needs positive start and end values." };
      return done((Math.pow(p[1] / p[0], 1 / args.years) - 1) * 100, "percent", "((end ÷ start)^(1 ÷ years) − 1) × 100");
    }
  }
}

export const calculatorTool: ToolDefinition<CalculatorArgs, CalculatorResult> = {
  name: "calculate",
  description:
    "Exact arithmetic. ALWAYS use this for any percentage change, return, difference, ratio, sum, average, min/max or CAGR you state — never compute in your head. Pass numbers taken from other tools' results. Operations: percent_change [from, to]; difference [a, b] (b − a); ratio [numerator, denominator]; sum/average/min/max [values…]; cagr [start, end] with years. Quote the `rounded` field.",
  parameters: {
    type: "object",
    properties: {
      operation: { type: "string", enum: [...OPERATIONS], description: "Which calculation to run." },
      values: { type: "array", items: { type: "number" }, description: "Inputs in the order the operation expects." },
      years: { type: "number", description: "Number of years (cagr only)." },
      decimals: { type: "integer", description: "Decimal places for the rounded result (default 2)." },
    },
    required: ["operation", "values"],
  },
  argsSchema,
  async execute(args) {
    const outcome = calculate(args);
    // A refused calculation names its reason in the source, so the model can
    // see why and say so instead of computing it some other way.
    return outcome.ok ? okResult(outcome.result, SOURCE) : failResult(`${SOURCE} (refused: ${outcome.reason})`);
  },
};
