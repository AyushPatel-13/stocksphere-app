import Groq from "groq-sdk";
import { LLMMessage, LLMCompletionResult, LLMToolCallRequest, ToolDefinition } from "../types";
import { LLMError } from "../errors";

// Configurable via env so the model can be changed without a code change.
const DEFAULT_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

let cachedClient: Groq | null = null;

function getClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new LLMError("GROQ_API_KEY is not configured on the server.");
  }

  if (!cachedClient) {
    // A hung call gets 25s instead of the SDK's 60s; the orchestrator also
    // keeps an overall budget for gathering data. Retries stay at 3 because
    // Groq's free tier (8,000 tokens a minute, ~5,000 per assistant turn)
    // answers 429 with a ~1-2s retry-after, which the SDK waits out.
    cachedClient = new Groq({ apiKey, timeout: 25_000, maxRetries: 3 });
  }

  return cachedClient;
}

// --- Provider-format translation -------------------------------------------
// Everything above/outside this file speaks LLMMessage / LLMCompletionResult.
// These two functions are the only place that knows Groq's (OpenAI-compatible)
// chat-completions wire format.

function toGroqMessages(messages: LLMMessage[]): Groq.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId ?? "",
        content: message.content ?? "",
      };
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }

    return {
      role: message.role as "system" | "user" | "assistant",
      content: message.content ?? "",
    };
  });
}

function toGroqTools(tools: ToolDefinition[]): Groq.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Optional second model for when the main one is rate-limited, e.g.
 * GROQ_FALLBACK_MODEL=openai/gpt-oss-20b. Unset means no fallback.
 */
const FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || null;

export function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

/**
 * A provider failure as a message fit for the user. The raw Groq error names
 * the account's organisation and upgrade links, so it is logged in short form
 * on the server and never passed through.
 */
export function toLLMError(error: unknown): LLMError {
  const status = statusOf(error);
  console.error(`Groq request failed (${status ?? "no status"}):`, error instanceof Error ? error.message.slice(0, 200) : "unknown");
  if (status === 429) return new LLMError("The AI service is busy right now. Please try again in a minute.");
  if (status === 401 || status === 403) return new LLMError("The AI service isn't configured correctly.");
  if (status === 400) return new LLMError("The AI service couldn't process that request. Please rephrase and try again.");
  return new LLMError("The AI service didn't respond. Please try again shortly.");
}

export interface ChatCompletionOptions {
  /**
   * "none" withholds tool calling for this one turn, so the model must answer
   * in prose from the conversation it already has. The orchestrator uses it to
   * ask for a final answer once its tool budget is spent, instead of
   * discarding the data it gathered and returning a failure. Defaults to
   * "auto", which is the behaviour every other caller already had.
   */
  toolChoice?: "auto" | "none";
}

export async function getChatCompletion(
  messages: LLMMessage[],
  tools: ToolDefinition[],
  options: ChatCompletionOptions = {}
): Promise<LLMCompletionResult> {
  const groq = getClient();
  const request = (model: string) =>
    groq.chat.completions.create({
      model,
      messages: toGroqMessages(messages),
      tools: toGroqTools(tools),
      tool_choice: options.toolChoice ?? "auto",
      temperature: 0.2,
      max_tokens: 1024,
    });

  let completion;
  try {
    completion = await request(DEFAULT_MODEL);
  } catch (error) {
    // Still rate-limited after the SDK's retries: try the fallback model, if
    // one is configured (a different model has its own token allowance).
    if (FALLBACK_MODEL && FALLBACK_MODEL !== DEFAULT_MODEL && statusOf(error) === 429) {
      try {
        completion = await request(FALLBACK_MODEL);
      } catch (fallbackError) {
        throw toLLMError(fallbackError);
      }
    } else {
      throw toLLMError(error);
    }
  }

  const choice = completion.choices?.[0]?.message;
  if (!choice) {
    throw new LLMError("The LLM provider returned no response choices.");
  }

  const toolCalls: LLMToolCallRequest[] | null = choice.tool_calls?.length
    ? choice.tool_calls
        .filter((call) => call.type === "function")
        .map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments ?? "{}",
        }))
    : null;

  return {
    content: choice.content ?? null,
    toolCalls,
  };
}
