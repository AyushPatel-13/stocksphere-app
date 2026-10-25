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

/**
 * A page or source to open, built by the server from what actually ran
 * (lib/agent/navigation.ts). Re-checked by the panel before rendering.
 */
export interface AgentLink {
  label: string;
  href: string;
  kind: "internal" | "external";
  note?: string;
  primary?: boolean;
}

export interface AgentResponse {
  answer: string;
  toolCalls: AgentToolCallTrace[];
  sources: string[];
  /** StockSphere pages and official sources relevant to the answer. */
  links?: AgentLink[];
  warnings: string[];
  conversationId: string;
}

export type AgentErrorCode =
  | "INVALID_REQUEST"
  | "SIGNED_OUT"
  | "RATE_LIMITED"
  | "LLM_ERROR"
  | "INTERNAL_ERROR";

export interface AgentErrorResponse {
  error: string;
  code: AgentErrorCode;
}
