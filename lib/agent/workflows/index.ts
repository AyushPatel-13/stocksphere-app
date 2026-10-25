import { getChatCompletion } from "../llm/client";
import { getUserClient } from "@/lib/supabase/server";
import type { AgentResponse } from "@/lib/types/agent";
import type { Workflow } from "./detect";
import { runAllowlistedTool, runWorkflow, type PaperPortfolio, type WorkflowContext, type WorkflowDeps } from "./run";
import {
  STARTING_CASH,
  computePositions,
  type PaperAssetType,
  type PaperCurrency,
  type PaperSide,
  type PaperTrade,
} from "@/lib/paper/ledger";

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

/**
 * The member's paper-trading account, read the same way: their token, so RLS
 * returns only their rows, plus the explicit user_id filter. Positions are
 * rebuilt from the trades with the same ledger the Paper page uses.
 */
async function loadPaper(ctx: WorkflowContext): Promise<PaperPortfolio | null> {
  const client = getUserClient(ctx.accessToken);
  if (!client) return null;
  const [account, trades] = await Promise.all([
    client.from("paper_accounts").select("cash_inr, cash_usd").eq("user_id", ctx.userId).maybeSingle(),
    client
      .from("paper_trades")
      .select("id, asset_type, symbol, side, quantity, price, currency, executed_at")
      .eq("user_id", ctx.userId)
      .order("executed_at", { ascending: true })
      .limit(1000),
  ]);
  if (account.error || trades.error) {
    console.error("AI paper read failed:", account.error?.code ?? trades.error?.code);
    return null;
  }
  const rows: PaperTrade[] = (trades.data ?? []).map((row) => ({
    id: String(row.id),
    assetType: row.asset_type as PaperAssetType,
    symbol: String(row.symbol),
    side: row.side as PaperSide,
    quantity: Number(row.quantity),
    price: Number(row.price),
    currency: row.currency as PaperCurrency,
    executedAt: String(row.executed_at),
  }));
  return {
    // No account row yet means no trades yet: the starting balance.
    cash: account.data ? { INR: Number(account.data.cash_inr), USD: Number(account.data.cash_usd) } : { ...STARTING_CASH },
    positions: computePositions(rows),
  };
}

export const defaultWorkflowDeps: WorkflowDeps = {
  getChatCompletion,
  runTool: runAllowlistedTool,
  loadHoldings,
  loadPaper,
  now: Date.now,
};

export function runDefaultWorkflow(workflow: Workflow, question: string, ctx: WorkflowContext, conversationId?: string): Promise<AgentResponse | null> {
  return runWorkflow(workflow, question, ctx, defaultWorkflowDeps, conversationId);
}
