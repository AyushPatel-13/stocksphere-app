import type { LLMCompletionResult, LLMMessage, LLMToolCallRequest, ToolDefinition } from "../../types";
import { type LLMProvider, type ProviderCallOptions, ProviderError, postJson, withTimeout } from "./types";

/**
 * OpenAI-style Chat Completions (POST {baseUrl}/chat/completions), as served
 * by Groq, Google's Gemini OpenAI-compatible endpoint and OpenRouter.
 */

type WireToolCall = { id?: string; type?: string; function?: { name?: string; arguments?: string }; [key: string]: unknown };
type WireMessage = { role: string; content: string | null; tool_calls?: WireToolCall[]; tool_call_id?: string };

export interface ChatCompletionsConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  /** Omit to use the model's default (Gemini 3 models recommend their default of 1.0). */
  temperature?: number;
  extraHeaders?: Record<string, string>;
  /**
   * Caps the chain's output budget for this provider. Groq counts max_tokens
   * against its 8,000 tokens-a-minute free limit before the call runs.
   */
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
}

export function toWireMessages(provider: string, messages: LLMMessage[]): WireMessage[] {
  return messages.map((message): WireMessage => {
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId ?? "", content: message.content ?? "" };
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      // The same provider gets its own turn back verbatim: Gemini requires the
      // thought signatures it attached to each tool call.
      if (message.raw?.provider === provider) return message.raw.data as WireMessage;
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })),
      };
    }
    return { role: message.role, content: message.content ?? "" };
  });
}

export function toWireTools(tools: ToolDefinition[]) {
  return tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
}

export function fromWireResponse(provider: string, body: Record<string, unknown>): LLMCompletionResult {
  const choice = (body.choices as { message?: WireMessage }[] | undefined)?.[0]?.message;
  if (!choice) throw new ProviderError(provider, null, "no response choices");

  const wireCalls = (choice.tool_calls ?? []).filter((call) => call.function?.name);
  const toolCalls: LLMToolCallRequest[] = wireCalls.map((call, index) => ({
    id: call.id || `call_${index}`,
    name: call.function!.name!,
    arguments: call.function!.arguments || "{}",
  }));

  return {
    content: typeof choice.content === "string" ? choice.content : null,
    toolCalls: toolCalls.length ? toolCalls : null,
    // Reasoning text (gpt-oss "reasoning") is left out: only what the API needs back is kept.
    raw: toolCalls.length
      ? { provider, data: { role: "assistant", content: choice.content ?? null, tool_calls: wireCalls.map((call, index) => ({ ...call, id: call.id || `call_${index}` })) } }
      : undefined,
  };
}

export function chatCompletionsProvider(config: ChatCompletionsConfig): LLMProvider {
  const id = `${config.provider}:${config.model}`;
  return {
    id,
    provider: config.provider,
    async complete(messages: LLMMessage[], tools: ToolDefinition[], options: ProviderCallOptions) {
      const body = {
        model: config.model,
        messages: toWireMessages(config.provider, messages),
        tools: toWireTools(tools),
        tool_choice: options.toolChoice,
        max_tokens: Math.min(options.maxOutputTokens, config.maxOutputTokens ?? Infinity),
        ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
      };
      const json = await withTimeout(id, options.timeoutMs, (signal) =>
        postJson(id, `${config.baseUrl}/chat/completions`, { authorization: `Bearer ${config.apiKey}`, ...config.extraHeaders }, body, signal, config.fetchImpl)
      );
      return { ...fromWireResponse(config.provider, json), servedBy: id };
    },
  };
}
