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
  /**
   * The member has agreed, in this browser, that a portfolio review may send
   * their holdings to the AI provider. Without it the server reads nothing.
   */
  portfolioConsent?: boolean;
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
  /**
   * Set instead of an answer to the question: the member must agree before
   * their own data is used. Nothing was read and no AI call was made.
   */
  needsConsent?: "portfolio";
}

/** What the member is told before a portfolio review: what is sent, to whom, and what isn't. */
export const PORTFOLIO_CONSENT_NOTICE =
  "To review your portfolio, StockSphere sends your holdings (symbols, quantities, buy prices and the values calculated from them) and your paper-trading account to our AI provider (Google Gemini or Groq) to write the answer. Your name, email and account details are not sent. Nothing is sent unless you allow it.";

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
