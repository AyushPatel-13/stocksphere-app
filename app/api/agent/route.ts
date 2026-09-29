import { NextResponse } from "next/server";
import { z } from "zod";
import { runAgent } from "@/lib/agent/orchestrator";
import { AgentError } from "@/lib/agent/errors";
import { AgentErrorResponse } from "@/lib/types/agent";

const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_MESSAGES = 20;

const historyMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

const requestSchema = z.object({
  message: z.string().trim().min(1, "message is required").max(MAX_MESSAGE_LENGTH),
  conversationId: z.string().trim().min(1).max(100).optional(),
  history: z.array(historyMessageSchema).max(MAX_HISTORY_MESSAGES).optional(),
});

// --- Minimal in-memory rate limiter -----------------------------------
// TODO(production): this is per-server-instance, in-memory state that
// resets on restart/redeploy and is NOT shared across multiple instances
// or serverless invocations. It is a placeholder to avoid unmetered LLM +
// market-data-provider spend during development. Before scaling beyond a
// single long-lived instance, replace this with a shared store (e.g.
// Redis) or a platform/edge-level rate limiter. Not replaced here per the
// instruction to avoid introducing a large new dependency for this.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const requestTimestampsByClient = new Map<string, number[]>();

function isRateLimited(clientId: string): boolean {
  const now = Date.now();
  const recent = (requestTimestampsByClient.get(clientId) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS
  );

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestTimestampsByClient.set(clientId, recent);
    return true;
  }

  recent.push(now);
  requestTimestampsByClient.set(clientId, recent);
  return false;
}

function getClientId(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: Request) {
  const clientId = getClientId(request);

  if (isRateLimited(clientId)) {
    const body: AgentErrorResponse = {
      error: "Too many requests. Please wait a moment and try again.",
      code: "RATE_LIMITED",
    };
    return NextResponse.json(body, { status: 429 });
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

  try {
    const result = await runAgent(parsed.data);
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
