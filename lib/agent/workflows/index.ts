import { getChatCompletion } from "../llm/client";
import { getUserClient } from "@/lib/supabase/server";
import type { AgentResponse } from "@/lib/types/agent";
import type { Workflow } from "./detect";
import { runAllowlistedTool, runWorkflow, type WorkflowContext, type WorkflowDeps } from "./run";

export { detectWorkflow, WORKFLOW_TYPES, type Workflow } from "./detect";
export type { WorkflowContext } from "./run";

/**
 * The member's holdings, read with their own token: row-level security plus
 * an explicit user_id filter, so only their rows can come back.
 */
async function loadHoldings(ctx: WorkflowContext) {
  const client = getUserClient(ctx.accessToken);
  if (!client) return null;
  const { data, error } = await client.from("portfolio").select("symbol, quantity, buy_price").eq("user_id", ctx.userId);
  if (error) {
    console.error("AI portfolio read failed:", error.code);
    return null;
  }
  return (data ?? [])
    .map((row) => ({ symbol: String(row.symbol).toUpperCase(), quantity: Number(row.quantity), buyPrice: Number(row.buy_price) }))
    .filter((h) => h.symbol && Number.isFinite(h.quantity) && Number.isFinite(h.buyPrice));
}

export const defaultWorkflowDeps: WorkflowDeps = {
  getChatCompletion,
  runTool: runAllowlistedTool,
  loadHoldings,
  now: Date.now,
};

export function runDefaultWorkflow(workflow: Workflow, question: string, ctx: WorkflowContext, conversationId?: string): Promise<AgentResponse | null> {
  return runWorkflow(workflow, question, ctx, defaultWorkflowDeps, conversationId);
}
