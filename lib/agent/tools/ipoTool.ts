import { z } from "zod";

import { getIpoBoard, type IpoBoardResult, type IpoRow } from "@/lib/services/ipo";
import { ToolDefinition, failResult, okResult } from "../types";

/**
 * Indian IPOs (mainboard and SME) from the same Upstox-backed board as the
 * IPO page, trimmed to the fields an answer needs. Grey-market premium is not
 * available from any source StockSphere may republish; the result says so.
 */

const SOURCE = "Upstox IPO API";

const argsSchema = z.object({
  section: z.enum(["open", "upcoming", "closed", "all"]).optional(),
  board: z.enum(["mainboard", "sme", "all"]).optional(),
  name: z.string().trim().min(1).max(60).optional(),
});

export type IpoToolArgs = z.infer<typeof argsSchema>;

export type IpoSummary = {
  name: string;
  symbol: string | null;
  board: string;
  section: string;
  openDate: string;
  closeDate: string;
  priceBand: string | null;
  lotSize: number | null;
  minInvestment: number | null;
  issueSizeCr: number | null;
  subscriptionTimes: number | null;
  allotmentDate: string | null;
  listingDate: string | null;
  listingPrice: number | null;
  listingGainPct: number | null;
  /** The red herring prospectus: where the company's financials and risks are, before listing. */
  rhpUrl: string | null;
};

export type IpoToolResult = {
  today: string;
  ipos: IpoSummary[];
  totalMatching: number;
  notes: string[];
};

const MAX_LISTED = 12;

function summarise(row: IpoRow): IpoSummary {
  return {
    name: row.name,
    symbol: row.symbol,
    board: row.board,
    section: row.section,
    openDate: row.openDate,
    closeDate: row.closeDate,
    priceBand: row.priceBand ? `₹${row.priceBand.low}–₹${row.priceBand.high}` : null,
    lotSize: row.lotSize,
    minInvestment: row.minInvestment,
    issueSizeCr: row.issueSizeCr,
    subscriptionTimes: row.subscription,
    allotmentDate: row.timeline?.allotmentDate ?? null,
    listingDate: row.timeline?.listingDate ?? null,
    listingPrice: row.listingPrice,
    listingGainPct: row.listingGainPct === null ? null : Math.round(row.listingGainPct * 100) / 100,
    rhpUrl: row.rhpUrl,
  };
}

export async function runIpoTool(
  args: IpoToolArgs,
  load: () => Promise<IpoBoardResult> = () => getIpoBoard()
): Promise<IpoToolResult | null> {
  const result = await load();
  if (!result.ok) return null;

  const section = args.section ?? "all";
  const board = args.board ?? "all";
  const needle = args.name?.toLowerCase();
  const matching = result.data.ipos.filter(
    (row) =>
      (section === "all" || row.section === section) &&
      (board === "all" || row.board === board) &&
      (!needle || row.name.toLowerCase().includes(needle) || row.symbol?.toLowerCase() === needle)
  );

  const notes = [
    "Grey-market premium (GMP) is not available in StockSphere.",
    "subscriptionTimes is the overall figure from Upstox; null before bidding opens.",
    "minInvestment = one lot × the upper end of the price band.",
  ];
  if (result.data.staleReason) notes.push(`Served from an earlier refresh: ${result.data.staleReason}`);

  return {
    today: result.data.today,
    ipos: matching.slice(0, MAX_LISTED).map(summarise),
    totalMatching: matching.length,
    notes,
  };
}

export const ipoTool: ToolDefinition<IpoToolArgs, IpoToolResult> = {
  name: "get_ipos",
  description:
    "Indian IPOs (mainboard and SME) from Upstox: open, upcoming or recently closed issues with dates, price band, lot size, minimum investment, issue size, overall subscription, allotment/listing dates, listing gain and the RHP (prospectus) link for company financials. Filter by section, board, or name (e.g. 'hd fire'). No GMP. Up to 12 are listed; totalMatching says how many there are.",
  parameters: {
    type: "object",
    properties: {
      section: { type: "string", enum: ["open", "upcoming", "closed", "all"], description: "Which IPOs (default all)." },
      board: { type: "string", enum: ["mainboard", "sme", "all"], description: "Mainboard or SME (default all)." },
      name: { type: "string", description: "Part of the company name, to look up one IPO." },
    },
    required: [],
  },
  argsSchema,
  async execute(args) {
    try {
      const result = await runIpoTool(args);
      return result ? okResult(result, SOURCE) : failResult(SOURCE);
    } catch {
      return failResult(SOURCE);
    }
  },
};
