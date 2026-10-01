import type { AgentMessage } from "@/lib/types/agent";

/**
 * Client-side view of the POST /api/agent contract.
 *
 * These limits mirror the validation in app/api/agent/route.ts, where they are
 * module-private and therefore not importable. They are duplicated here — the
 * same way isIndianSymbol is duplicated across the provider files — rather than
 * loosened on the server or left unenforced on the client.
 *
 * Enforcing them in the browser is not about trusting the client: it means a
 * long question or a long assistant answer degrades into something readable
 * instead of coming back as a 400 after the user has already waited for it.
 */
export const MAX_MESSAGE_LENGTH = 500;
export const MAX_HISTORY_MESSAGES = 20;

const TRUNCATION_MARKER = "…";

/**
 * Cut a string to `max` characters, marking the cut so a truncated turn is not
 * mistaken for a complete one.
 */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max <= TRUNCATION_MARKER.length) return value.slice(0, max);
  return value.slice(0, max - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

/**
 * The one line of stock context the agent is given about what the user is
 * looking at.
 *
 * The API contract has no dedicated symbol field — `AgentRequest` carries only
 * message, conversationId and history — so context travels inside the message
 * text, which is the channel the contract provides. The framing is deliberately
 * factual: it says what page the user is on and what their pronouns refer to.
 * It does not name a tool or prescribe a lookup, so the agent still resolves the
 * symbol itself through resolve_symbol and still applies its own rule about not
 * inventing data.
 *
 * Kept short because it is charged against the same 500-character budget as the
 * user's own question.
 */
export function buildStockContext(symbol?: string | null): string {
  const trimmed = symbol?.trim();
  if (!trimmed) return "";

  return `[Context: user is viewing ${trimmed}; "this stock"/"this company" means ${trimmed}.]`;
}

/**
 * How long a question may be once the context line is prepended.
 *
 * The textarea is capped with this so the composed message can never exceed the
 * server's limit, instead of being silently truncated mid-sentence.
 */
export function maxQuestionLength(symbol?: string | null): number {
  const context = buildStockContext(symbol);
  const separator = context ? 1 : 0;
  return Math.max(1, MAX_MESSAGE_LENGTH - context.length - separator);
}

/**
 * The exact string sent to POST /api/agent for a question typed on a stock
 * page. The caller keeps the user's raw text for display, so the context line
 * is never shown back to them as if they had typed it.
 */
export function composeMessage(
  text: string,
  symbol?: string | null
): string {
  const question = text.trim();
  const context = buildStockContext(symbol);

  if (!context) {
    return truncate(question, MAX_MESSAGE_LENGTH);
  }

  return `${context} ${truncate(question, maxQuestionLength(symbol))}`;
}

/**
 * Prior turns, shaped for `AgentRequest.history`.
 *
 * The orchestrator replays history into the model and appends `message` after
 * it, so the turn currently being sent must NOT be in here — it travels in
 * `message`.
 *
 * Assistant answers are frequently longer than the server's 500-character
 * per-entry maximum, and a single oversized entry fails validation for the
 * whole request. Trimming each entry keeps the transcript usable; trimming the
 * oldest entries first keeps the most recent context, which is the context the
 * user's follow-up actually depends on.
 */
export function buildHistory(turns: AgentMessage[]): AgentMessage[] {
  return turns.slice(-MAX_HISTORY_MESSAGES).map((turn) => ({
    role: turn.role,
    content: truncate(turn.content, MAX_MESSAGE_LENGTH),
  }));
}
