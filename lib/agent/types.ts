import { z } from "zod";

// --- Tool result envelope ----------------------------------------------
// Every tool returns exactly this shape so the orchestrator never has to
// special-case a tool's output. `ok: false` means "no reliable data was
// available" and must never be papered over with a guessed value.

export interface ToolResult<T> {
  ok: boolean;
  data: T | null;
  source: string;
  fetchedAt: string;
}

export function okResult<T>(data: T, source: string): ToolResult<T> {
  return { ok: true, data, source, fetchedAt: new Date().toISOString() };
}

export function failResult<T = never>(source: string): ToolResult<T> {
  return { ok: false, data: null, source, fetchedAt: new Date().toISOString() };
}

// --- Tool definitions -----------------------------------------------------

export interface ToolJsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

// Default generics only apply to the heterogeneous AGENT_TOOLS array; every
// individual tool still declares its own precise ToolDefinition<X, Y>.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDefinition<TArgs = any, TData = any> {
  name: string;
  description: string;
  /** JSON Schema handed to the LLM's native tool/function-calling API. */
  parameters: ToolJsonSchema;
  /** Runtime validator for arguments the LLM actually returns. */
  argsSchema: z.ZodType<TArgs>;
  execute: (args: TArgs) => Promise<ToolResult<TData>>;
}

// --- LLM message plumbing (provider-agnostic) ------------------------------
// lib/agent/llm/client.ts is the only file that translates these into a
// specific provider's wire format, so swapping providers later only means
// rewriting that one file.

export type LLMRole = "system" | "user" | "assistant" | "tool";

export interface LLMToolCallRequest {
  id: string;
  name: string;
  /** Raw JSON string, exactly as returned by the provider. */
  arguments: string;
}

export interface LLMMessage {
  role: LLMRole;
  content: string | null;
  /** Present only on role: "tool" messages. */
  toolCallId?: string;
  /** Present only on assistant messages that requested tool calls. */
  toolCalls?: LLMToolCallRequest[];
}

export interface LLMCompletionResult {
  content: string | null;
  toolCalls: LLMToolCallRequest[] | null;
}

// --- Normalized domain types exposed to the LLM ----------------------------
// These are the *agent's* stable shapes, independent of which upstream
// provider (Finnhub, TwelveData, ...) produced the raw data.

export interface NormalizedNewsArticle {
  id: string;
  headline: string;
  summary: string;
  url: string;
  source: string;
  /** ISO 8601 timestamp, or null if the provider didn't supply one. */
  publishedAt: string | null;
}

export interface NormalizedHistoricalPoint {
  /** YYYY-MM-DD */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface FinancialMetrics {
  marketCap: number | null;
  pe: number | null;
  eps: number | null;
  dividendYield: number | null;
  week52High: number | null;
  week52Low: number | null;
  roe: number | null;
}

export interface SymbolCandidate {
  symbol: string;
  name: string;
}

export interface SymbolResolution {
  query: string;
  candidates: SymbolCandidate[];
  /** Always false: this resolver is a small built-in list, never a real search. */
  authoritative: false;
}
