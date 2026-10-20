import { ToolDefinition } from "../types";
import { symbolResolverTool } from "./symbolResolverTool";
import { companyTool } from "./companyTool";
import { priceTool } from "./priceTool";
import { financialsTool } from "./financialsTool";
import { newsTool } from "./newsTool";
import { historicalTool } from "./historicalTool";
import { marketMoversTool } from "./marketMoversTool";
import { calculatorTool } from "./calculatorTool";
import { screenerTool } from "./screenerTool";
import { performanceTool } from "./performanceTool";
import { earningsTool } from "./earningsTool";

export const AGENT_TOOLS: ToolDefinition[] = [
  symbolResolverTool,
  companyTool,
  priceTool,
  financialsTool,
  newsTool,
  historicalTool,
  marketMoversTool,
  calculatorTool,
  screenerTool,
  performanceTool,
  earningsTool,
];

export function getToolByName(name: string): ToolDefinition | undefined {
  return AGENT_TOOLS.find((tool) => tool.name === name);
}
