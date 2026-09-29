import { ToolDefinition } from "../types";
import { symbolResolverTool } from "./symbolResolverTool";
import { companyTool } from "./companyTool";
import { priceTool } from "./priceTool";
import { financialsTool } from "./financialsTool";
import { newsTool } from "./newsTool";
import { historicalTool } from "./historicalTool";

export const AGENT_TOOLS: ToolDefinition[] = [
  symbolResolverTool,
  companyTool,
  priceTool,
  financialsTool,
  newsTool,
  historicalTool,
];

export function getToolByName(name: string): ToolDefinition | undefined {
  return AGENT_TOOLS.find((tool) => tool.name === name);
}
