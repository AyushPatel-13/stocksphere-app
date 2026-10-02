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
    cachedClient = new Groq({ apiKey });
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

  let completion;
  try {
    completion = await groq.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: toGroqMessages(messages),
      tools: toGroqTools(tools),
      tool_choice: options.toolChoice ?? "auto",
      temperature: 0.2,
      max_tokens: 1024,
    });
  } catch (error) {
  console.error("🔥🔥🔥 GROQ ERROR 🔥🔥🔥");
  console.error(error);

  throw new LLMError(
    error instanceof Error ? error.message : "Unknown error contacting the LLM provider."
  );
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
