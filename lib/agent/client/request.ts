import type {
  AgentErrorCode,
  AgentErrorResponse,
  AgentRequest,
  AgentResponse,
} from "@/lib/types/agent";

/** The only backend this frontend talks to. There is no second agent server. */
export const AGENT_ENDPOINT = "/api/agent";

/**
 * A tool-calling turn can make several provider calls plus several LLM
 * round-trips. The server always answers within 50 s (AGENT_DEADLINE_MS, a
 * partial answer if need be), so this only bounds a request that hung on the
 * way, with room for the network on top.
 */
export const AGENT_TIMEOUT_MS = 65_000;

/** Server-side codes, plus the two failure modes that never reach the server. */
export type AgentClientErrorCode =
  | AgentErrorCode
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "MALFORMED_RESPONSE";

export class AgentRequestError extends Error {
  readonly code: AgentClientErrorCode;

  constructor(code: AgentClientErrorCode, message: string) {
    super(message);
    this.name = "AgentRequestError";
    this.code = code;
  }
}

/**
 * What each failure looks like to the person waiting.
 *
 * The server's own `error` field is carried alongside for developers (see
 * `technical`), but it is never rendered. For LLM_ERROR in particular that
 * string is the raw provider message straight out of lib/agent/llm/client.ts,
 * which is exactly the kind of detail the UI should not be showing.
 */
const FRIENDLY_MESSAGES: Record<AgentClientErrorCode, string> = {
  NETWORK_ERROR:
    "Couldn't reach StockSphere AI. Check your connection and try again.",
  TIMEOUT: "StockSphere AI took too long to respond. Please try again.",
  MALFORMED_RESPONSE:
    "StockSphere AI sent back a response that couldn't be read. Please try again.",
  SIGNED_OUT: "Sign in to ask StockSphere AI.",
  RATE_LIMITED:
    "You've reached the StockSphere AI limit (5 questions a minute, 40 a day). Please try again a little later.",
  INVALID_REQUEST:
    "That question couldn't be sent. Try shortening it or rephrasing.",
  LLM_ERROR: "StockSphere AI is temporarily unavailable. Please try again.",
  INTERNAL_ERROR:
    "Something went wrong while contacting StockSphere AI. Please try again.",
};

export function friendlyMessage(code: AgentClientErrorCode): string {
  return FRIENDLY_MESSAGES[code];
}

function isErrorCode(value: unknown): value is AgentErrorCode {
  return (
    value === "INVALID_REQUEST" ||
    value === "SIGNED_OUT" ||
    value === "RATE_LIMITED" ||
    value === "LLM_ERROR" ||
    value === "INTERNAL_ERROR"
  );
}

/**
 * Narrow an unknown JSON body to something we can safely read an error from.
 * Anything else — an HTML error page, a proxy's plain-text 502 — is left to the
 * caller to turn into MALFORMED_RESPONSE.
 */
export function readErrorBody(body: unknown): {
  code: AgentErrorCode | null;
  technical: string | null;
} {
  if (!body || typeof body !== "object") return { code: null, technical: null };

  const candidate = body as Partial<AgentErrorResponse>;
  return {
    code: isErrorCode(candidate.code) ? candidate.code : null,
    technical: typeof candidate.error === "string" ? candidate.error : null,
  };
}

/**
 * A success body is only a success if it actually carries an answer.
 *
 * The route returns the orchestrator's result unmodified, so `answer` is
 * normally always present — but an empty one would render as a blank bubble,
 * which reads as a broken UI rather than as a failed request. Treating it as
 * malformed means the user gets the same retryable notice as a network failure.
 */
export function isAgentResponse(value: unknown): value is AgentResponse {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<AgentResponse>;
  return (
    typeof candidate.answer === "string" &&
    candidate.answer.trim().length > 0
  );
}

/**
 * Turn a non-OK response into an AgentRequestError, preferring the server's
 * code over the HTTP status because the code is the more precise signal —
 * a 429 and a 400 both come back as errors but mean different things to a user.
 */
export async function toRequestError(
  response: Response
): Promise<AgentRequestError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const { code, technical } = readErrorBody(body);
  const resolved: AgentClientErrorCode =
    code ??
    (response.status === 429
      ? "RATE_LIMITED"
      : response.status === 401
        ? "SIGNED_OUT"
        : "INTERNAL_ERROR");

  const error = new AgentRequestError(resolved, friendlyMessage(resolved));
  // Developer-facing detail, never rendered. See FRIENDLY_MESSAGES above.
  error.cause = technical ?? `HTTP ${response.status}`;
  return error;
}

/**
 * POST /api/agent.
 *
 * `fetchImpl` is injected so the request/response handling can be tested
 * without a server, and without a GROQ_API_KEY — the same convention the agent
 * tools use for their provider clients. `accessToken` is the signed-in
 * member's Supabase token; without one the server answers SIGNED_OUT.
 */
export async function sendAgentMessage(
  request: AgentRequest,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = AGENT_TIMEOUT_MS,
  accessToken: string | null = null
): Promise<AgentResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(AGENT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (error) {
    const aborted =
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError");

    throw new AgentRequestError(
      aborted ? "TIMEOUT" : "NETWORK_ERROR",
      friendlyMessage(aborted ? "TIMEOUT" : "NETWORK_ERROR")
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw await toRequestError(response);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AgentRequestError(
      "MALFORMED_RESPONSE",
      friendlyMessage("MALFORMED_RESPONSE")
    );
  }

  if (!isAgentResponse(body)) {
    throw new AgentRequestError(
      "MALFORMED_RESPONSE",
      friendlyMessage("MALFORMED_RESPONSE")
    );
  }

  return body;
}
