import { z } from "zod";

import { getFoBanList, type FoBanList } from "@/lib/apis/nseFoBan";
import { ToolDefinition, failResult, okResult } from "../types";

/**
 * The current F&O ban list, straight from NSE's daily file. Anything about
 * which stocks are in the ban today must come from here; the rules of the
 * ban itself are in get_market_term.
 */

const SOURCE = "NSE F&O ban list (nsearchives.nseindia.com, fo_secban.csv)";
// Extra arguments a model adds ("date": "today") are ignored: the file is always the latest.
const argsSchema = z.object({});

export function createFoBanTool(load: () => Promise<FoBanList | null> = () => getFoBanList()): ToolDefinition<z.infer<typeof argsSchema>, FoBanList & { count: number }> {
  return {
    name: "get_fo_ban_list",
    description:
      "Today's NSE F&O ban list (securities in the ban period for the stated trade date), from NSE's daily file. Use for 'which stocks are in the F&O ban', 'is X in the ban today'. An empty list means no securities are in ban.",
    parameters: { type: "object", properties: {} },
    argsSchema,
    async execute() {
      const list = await load();
      return list ? okResult({ ...list, count: list.securities.length }, SOURCE) : failResult(SOURCE);
    },
  };
}

export const foBanTool = createFoBanTool();
