import { z } from "zod";
import { getHistorical } from "@/lib/services/historical";
import { HISTORICAL_RANGES } from "@/lib/types/historical";
import { normalizeHistorical } from "../normalizers/historical";
import { ToolDefinition, NormalizedHistoricalPoint, okResult, failResult } from "../types";

// Provider-neutral on purpose: lib/providers/historical.ts routes Indian
// .NS/.BSE symbols to Upstox and everything else to TwelveData, and the service
// does not surface which of the two answered. Naming a provider here would be a
// claim that is wrong for half the symbols this tool handles — the same reason
// lib/agent/tools/newsTool.ts and priceTool.ts use a generic service label.
//
// Exported for direct unit testing of that neutrality, the same reason
// priceTool.ts exports isValidPrice().
export const SOURCE = "StockSphere Historical Service";

/**
 * Trading sessions per range, used to trim whatever the provider returned.
 *
 * This remains the thing that decides the answer. Both provider paths
 * over-fetch — TwelveData asks for a flat 365 bars, and the Upstox path asks
 * for a window deliberately wider than the range needs — so this slice is what
 * reduces that to the range actually requested. Removing it would silently
 * redefine "1m" as "everything the provider happened to return".
 *
 * There is no entry for "max" by design: it is bounded by MAX_POINTS instead.
 */
const RANGE_TRADING_DAYS: Record<string, number> = {
  "1m": 22,
  "3m": 66,
  "6m": 132,
  "1y": 252,
};

/**
 * The most points get_historical will return, for "max" and for an omitted
 * range.
 *
 * This is a limit on the TOOL'S RESPONSE, not on the data. lib/providers/
 * historical.ts still fetches and returns the provider's full history — Upstox
 * reaches back about nine years, ~2,227 candles for a large cap — and
 * app/stock/[symbol]/page.tsx still receives all of it, so the chart is
 * unaffected. Only the agent-facing result is capped.
 *
 * Why it is needed: 2,227 points serialise to about 203 KB, roughly 58k tokens,
 * in a single tool result. That is nearly half of the model's context spent on
 * one call, and it makes a "how has this moved over the long term" question
 * crowd out everything else in the conversation.
 *
 * 500 is about two trading years — deliberately more than the 252 sessions
 * "1y" returns, so "max" still means "more history than any other range" and
 * stays worth asking for, while landing around 13k tokens.
 */
export const MAX_POINTS = 500;

const argsSchema = z.object({
  symbol: z.string().trim().min(1).max(20),
  // The same tuple the provider reads its date windows from, so the accepted
  // ranges and the fetch windows cannot drift apart.
  range: z.enum(HISTORICAL_RANGES).optional(),
});

export type HistoricalToolArgs = z.infer<typeof argsSchema>;

/**
 * Trim a payload to a range, keeping the most recent sessions.
 *
 * Slicing from the end of an ascending array is what keeps the result
 * chronological: the points handed back are the newest N, still oldest-first,
 * so the ordering the description promises ("ascending by date") survives the
 * cap unchanged.
 *
 * "max" (and an omitted range) is bounded by MAX_POINTS rather than being
 * passed through untouched. What bounds it is otherwise the provider — about
 * nine years on Upstox, 365 bars on TwelveData — and a tool result of that size
 * is not something the model's context can absorb usefully.
 */
export function sliceByRange(
  points: NormalizedHistoricalPoint[],
  range: string | undefined
): NormalizedHistoricalPoint[] {
  if (!range || range === "max") return points.slice(-MAX_POINTS);

  const days = RANGE_TRADING_DAYS[range];

  // An unrecognised range is capped like "max" rather than returned unbounded.
  // argsSchema already rejects one, so this is belt-and-braces.
  return points.slice(-(days ?? MAX_POINTS));
}

/**
 * What get_historical should do with a raw provider payload.
 *
 * Exported so the three-way decision can be unit-tested directly, without a
 * network or a stubbed service — the same reason priceTool.ts exports
 * isValidPrice().
 */
export type HistoricalOutcome =
  | { status: "failure" }
  | { status: "empty" }
  | { status: "ok"; points: NormalizedHistoricalPoint[] };

/**
 * Decide between "the provider could not be read", "the provider holds no
 * candles for this window", and "here is the data".
 *
 * The first two used to be the same answer — both ended in failResult — which
 * meant a provider that answered honestly with an empty window was reported to
 * the model as a broken lookup, and a broken lookup could equally have been
 * read as "this stock has no history". They are different facts:
 *
 *   null / non-object        -> failure  (we do not know anything)
 *   { values: [] }           -> empty    (we know: no candles in this window)
 *   { values: [<unusable>] } -> failure  (rows arrived but none is a data point)
 *   { values: [<usable>] }   -> ok
 */
export function classifyHistorical(raw: unknown): HistoricalOutcome {
  if (!raw || typeof raw !== "object") {
    return { status: "failure" };
  }

  const points = normalizeHistorical(raw);

  if (points.length > 0) {
    return { status: "ok", points };
  }

  // Nothing usable came out. An upstream array that was genuinely empty is an
  // answer; an array that had rows, none of which survived normalization, is a
  // data problem and must not be dressed up as "no history".
  const values = (raw as { values?: unknown }).values;

  return Array.isArray(values) && values.length === 0
    ? { status: "empty" }
    : { status: "failure" };
}

export const historicalTool: ToolDefinition<HistoricalToolArgs, NormalizedHistoricalPoint[]> = {
  name: "get_historical",
  description:
    "Get historical daily OHLCV data for a stock ticker symbol, ascending by date. Use this to describe recent price trends/movement (e.g. 'why has it been moving').",
  parameters: {
    type: "object",
    properties: {
      symbol: {
        type: "string",
        description: "Stock ticker symbol, e.g. AAPL, TCS.NS, INFY.NS",
      },
      range: {
        type: "string",
        enum: [...HISTORICAL_RANGES],
        // "max" is described as bounded because it is, twice over: no provider
        // here serves unlimited history (Upstox reaches back about nine years,
        // TwelveData returns 365 bars), and the tool itself caps what it will
        // send in one response (MAX_POINTS). Promising "unlimited" or "every
        // candle" would invite the model to answer questions this data cannot
        // support.
        description:
          "How far back to look. '1m', '3m', '6m' and '1y' return that many trading sessions. Defaults to 'max', which returns the most recent history available, up to the maximum this tool sends in one response — not every candle the provider holds.",
      },
    },
    required: ["symbol"],
  },
  argsSchema,
  async execute({ symbol, range }) {
    try {
      // The documented default is "as far back as the provider holds", so an
      // omitted range is passed through explicitly. Leaving it undefined would
      // mean something different downstream: the service's default window, which
      // is sized for the stock chart rather than for this tool.
      const raw = await getHistorical(symbol, range ?? "max");
      const outcome = classifyHistorical(raw);

      if (outcome.status === "failure") {
        return failResult(SOURCE);
      }

      if (outcome.status === "empty") {
        return okResult([], SOURCE);
      }

      return okResult(sliceByRange(outcome.points, range), SOURCE);
    } catch {
      return failResult(SOURCE);
    }
  },
};
