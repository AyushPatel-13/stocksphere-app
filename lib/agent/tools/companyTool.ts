import { z } from "zod";
import { getCompany } from "@/lib/services/company";
import { CompanyProfile } from "@/lib/types/company";
import { ToolDefinition, okResult, failResult } from "../types";

// Note: lib/services/company.ts does not surface which upstream provider
// (Finnhub vs Alpha Vantage) actually answered, so this source label is
// intentionally generic rather than claiming a specific provider.
const SOURCE = "StockSphere Company Service";

const argsSchema = z.object({
  symbol: z.string().trim().min(1).max(20),
});

export type CompanyToolArgs = z.infer<typeof argsSchema>;

// Exported for direct unit testing of the validity rule without needing to
// mock the network-backed getCompany() service.
export function isValidCompany(
  company: CompanyProfile | null | undefined
): company is CompanyProfile {
  return !!company && typeof company.name === "string" && company.name.trim().length > 0;
}

export const companyTool: ToolDefinition<CompanyToolArgs, CompanyProfile> = {
  name: "get_company",
  description:
    "Get company profile information (name, sector, industry, exchange, country, market cap, website) for a stock ticker symbol. Use this for 'what is <company>' or 'tell me about <company>' questions.",
  parameters: {
    type: "object",
    properties: {
      symbol: {
        type: "string",
        description: "Stock ticker symbol, e.g. AAPL, TCS.NS, INFY.NS",
      },
    },
    required: ["symbol"],
  },
  argsSchema,
  async execute({ symbol }) {
    try {
      const company = await getCompany(symbol);
      if (!isValidCompany(company)) {
        return failResult(SOURCE);
      }
      return okResult(company, SOURCE);
    } catch {
      return failResult(SOURCE);
    }
  },
};
