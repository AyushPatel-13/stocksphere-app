// Public contract for POST /api/agent.
// These types describe what crosses the HTTP boundary, not internal
// orchestration details (see lib/agent/types.ts for those).

export type AgentMessageRole = "user" | "assistant";

export interface AgentMessage {
  role: AgentMessageRole;
  content: string;
}

export interface AgentRequest {
  message: string;
  conversationId?: string;
  history?: AgentMessage[];
}

export interface AgentToolCallTrace {
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  source: string;
}

export interface AgentResponse {
  answer: string;
  toolCalls: AgentToolCallTrace[];
  sources: string[];
  warnings: string[];
  conversationId: string;
}

export type AgentErrorCode =
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "LLM_ERROR"
  | "INTERNAL_ERROR";

export interface AgentErrorResponse {
  error: string;
  code: AgentErrorCode;
}
