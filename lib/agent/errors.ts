import { AgentErrorCode } from "@/lib/types/agent";

export class AgentError extends Error {
  code: AgentErrorCode;
  status: number;

  constructor(message: string, code: AgentErrorCode, status: number) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.status = status;
  }
}

export class ValidationError extends AgentError {
  constructor(message: string) {
    super(message, "INVALID_REQUEST", 400);
    this.name = "ValidationError";
  }
}

export class RateLimitError extends AgentError {
  constructor(message = "Too many requests. Please wait a moment and try again.") {
    super(message, "RATE_LIMITED", 429);
    this.name = "RateLimitError";
  }
}

export class LLMError extends AgentError {
  constructor(message: string) {
    super(message, "LLM_ERROR", 502);
    this.name = "LLMError";
  }
}
