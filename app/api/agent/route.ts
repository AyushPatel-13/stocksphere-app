import { answerCache } from "@/lib/agent/answerCache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { runAgent } from "@/lib/agent/orchestrator";
import { AgentError } from "@/lib/agent/errors";
import { bearerToken, defaultAgentAccess, type AgentAccess } from "@/lib/agent/access";
import { detectWorkflow, runDefaultWorkflow, type Workflow } from "@/lib/agent/workflows";
import { AgentErrorResponse } from "@/lib/types/agent";

// The agent finishes within AGENT_DEADLINE_MS (50 s); this lets the platform
// run it that long (Vercel's default limit can be shorter).
export const maxDuration = 60;

const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_MESSAGES = 20;

const historyMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

const companyQuery = z.string().trim().min(1).max(60);

/** A research entry point chosen in the UI; the server still resolves and validates every name. */
const workflowSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("research"), query: companyQuery }),
  z.object({ type: z.literal("explain_move"), query: companyQuery }),
  z.object({ type: z.literal("compare"), queries: z.array(companyQuery).min(2).max(3) }),
  z.object({ type: z.literal("portfolio") }),
]);

const requestSchema = z.object({
  message: z.string().trim().min(1, "message is required").max(MAX_MESSAGE_LENGTH),
  conversationId: z.string().trim().min(1).max(100).optional(),
  history: z.array(historyMessageSchema).max(MAX_HISTORY_MESSAGES).optional(),
  workflow: workflowSchema.optional(),
});

/**
 * POST /api/agent
 *   Authorization: Bearer <Supabase access token>
 *
 * Signed-in members only, rate limited per account (see lib/agent/access.ts).
 * A repeat of a recent stand-alone question is served from the answer cache
 * and doesn't count against the limit.
 *
 * Research questions (a report on a stock, why it moved, a comparison, a
 * portfolio review) run as workflows: the data is gathered server-side and
 * written up in one model call (lib/agent/workflows). Everything else, and any
 * workflow whose company can't be identified, goes to the tool loop.
 */
export async function POST(
  request: Request,
  _context?: unknown,
  access: AgentAccess = defaultAgentAccess,
  run: typeof runAgent = runAgent,
  workflow: typeof runDefaultWorkflow = runDefaultWorkflow
) {
  const token = bearerToken(request);
  const userId = token ? await access.verifyToken(token) : null;
  if (!userId) {
    const body: AgentErrorResponse = { error: "Sign in to use StockSphere AI.", code: "SIGNED_OUT" };
    return NextResponse.json(body, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    const body: AgentErrorResponse = { error: "Invalid JSON body.", code: "INVALID_REQUEST" };
    return NextResponse.json(body, { status: 400 });
  }

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    const body: AgentErrorResponse = {
      error: parsed.error.issues[0]?.message || "Invalid request body.",
      code: "INVALID_REQUEST",
    };
    return NextResponse.json(body, { status: 400 });
  }

  // A stand-alone question asked again within a couple of minutes is answered
  // from the cache (same answer, new conversation id).
  const standalone = !parsed.data.history || parsed.data.history.length === 0;
  const chosen: Workflow | null = parsed.data.workflow ?? (standalone ? detectWorkflow(parsed.data.message) : null);
  // The answer cache is shared by everyone and keyed by the question alone, so
  // an answer built from one member's own data must never enter or leave it.
  const cacheable = standalone && chosen?.type !== "portfolio";
  const cached = cacheable ? answerCache.get(parsed.data.message) : null;
  if (cached) {
    return NextResponse.json({ ...cached, conversationId: parsed.data.conversationId ?? cached.conversationId });
  }

  const slot = await access.takeSlot(userId);
  if (!slot.ok) {
    const body: AgentErrorResponse = {
      error:
        slot.window === "day"
          ? "You've reached today's limit for StockSphere AI. It resets within 24 hours."
          : "Too many questions in a minute. Please wait a moment and try again.",
      code: "RATE_LIMITED",
    };
    return NextResponse.json(body, { status: 429, headers: { "Retry-After": String(slot.retryAfterSeconds) } });
  }

  try {
    const fromWorkflow = chosen
      ? await workflow(chosen, parsed.data.message, { userId, accessToken: token! }, parsed.data.conversationId)
      : null;
    const result = fromWorkflow ?? (await run({ message: parsed.data.message, conversationId: parsed.data.conversationId, history: parsed.data.history }));
    if (cacheable) answerCache.set(parsed.data.message, result);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AgentError) {
      const body: AgentErrorResponse = { error: error.message, code: error.code };
      return NextResponse.json(body, { status: error.status });
    }

    console.error("Unhandled /api/agent error:", error);
    const body: AgentErrorResponse = {
      error: "An unexpected error occurred.",
      code: "INTERNAL_ERROR",
    };
    return NextResponse.json(body, { status: 500 });
  }
}
