import { checkContent } from "../../community/rules";
import { SCORING_V2, type CallDirection, type Horizon, type ScoringConfig } from "./config";
import type { PredictionAssetKind } from "./reference";

/**
 * Validation of a new prediction's request body, before any price is read.
 * Pure. The target is checked again against the band once the reference
 * price is known (validateTarget in ./engine).
 */

export type ParsedSubmission = {
  requestId: string;
  assetType: PredictionAssetKind;
  symbol: string;
  direction: CallDirection;
  horizon: Horizon;
  target: number | null;
  note: string | null;
};

export type SubmissionCheck =
  | { ok: true; value: ParsedSubmission }
  | { ok: false; status: 400 | 422; reason: string; code: "BAD_REQUEST" | "RULES" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSET_TYPES: PredictionAssetKind[] = ["stock", "index", "etf", "crypto"];
const DIRECTIONS: CallDirection[] = ["up", "down", "sideways"];

export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isExcludedSymbol(symbol: string, config: ScoringConfig = SCORING_V2): boolean {
  return config.submission.excludedSymbols.includes(symbol.toUpperCase());
}

export function parseSubmission(
  raw: {
    requestId?: unknown;
    assetType?: unknown;
    symbol?: unknown;
    direction?: unknown;
    horizon?: unknown;
    target?: unknown;
    note?: unknown;
  },
  config: ScoringConfig = SCORING_V2
): SubmissionCheck {
  const bad = (reason: string): SubmissionCheck => ({ ok: false, status: 400, reason, code: "BAD_REQUEST" });
  const rule = (reason: string): SubmissionCheck => ({ ok: false, status: 422, reason, code: "RULES" });

  if (!isRequestId(raw.requestId)) return bad("Missing or invalid request id. Reload the page and try again.");

  const assetType = raw.assetType === undefined ? "stock" : raw.assetType;
  if (!ASSET_TYPES.includes(assetType as PredictionAssetKind)) return bad("Unknown asset type.");

  if (typeof raw.symbol !== "string" || !raw.symbol.trim()) return bad("Enter a symbol.");
  const symbol = raw.symbol.trim().toUpperCase();
  if (isExcludedSymbol(symbol, config)) {
    return rule("Liquid and bond ETFs barely move, so they can't be predicted.");
  }

  if (!DIRECTIONS.includes(raw.direction as CallDirection)) return rule("Pick up, down or sideways.");
  const direction = raw.direction as CallDirection;

  if (typeof raw.horizon !== "string" || !Object.prototype.hasOwnProperty.call(config.horizons, raw.horizon)) {
    return rule("Pick a time frame.");
  }
  const horizon = raw.horizon as Horizon;

  let target: number | null = null;
  if (raw.target !== null && raw.target !== undefined && raw.target !== "") {
    if (direction === "sideways") return rule("SIDEWAYS calls don't take a target.");
    target = Number(raw.target);
    if (!Number.isFinite(target) || target <= 0) return rule("The target must be a positive number.");
  }

  let note: string | null = null;
  if (typeof raw.note === "string" && raw.note.trim()) {
    const verdict = checkContent(raw.note.slice(0, 280), false);
    if (!verdict.ok) return rule(verdict.reason);
    note = verdict.body;
  }

  return { ok: true, value: { requestId: raw.requestId.toLowerCase(), assetType: assetType as PredictionAssetKind, symbol, direction, horizon, target, note } };
}
