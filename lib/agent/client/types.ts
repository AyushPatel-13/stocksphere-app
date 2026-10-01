import type { AgentClientErrorCode } from "./request";

/**
 * One turn in the panel.
 *
 * `content` is what the user sees. For a user turn `wire` is what was actually
 * sent — the question with the stock context line prepended — kept separately
 * so the injected context is never shown back to the user as if they had typed
 * it, while the transcript sent to the agent still carries it.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  wire?: string;
  /** From AgentResponse — real provenance, never fabricated in the UI. */
  sources?: string[];
  warnings?: string[];
  tools?: string[];
  /** Set on a user turn whose request failed, so the panel can offer a retry. */
  failed?: boolean;
}

export interface ChatFailure {
  code: AgentClientErrorCode;
  message: string;
}
