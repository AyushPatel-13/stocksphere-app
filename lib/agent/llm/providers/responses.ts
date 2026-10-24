import type { LLMCompletionResult, LLMMessage, LLMToolCallRequest, ToolDefinition } from "../../types";
import { type LLMProvider, type ProviderCallOptions, ProviderError, postJson, withTimeout } from "./types";

/**
 * The Responses API (POST {baseUrl}/responses), used by OpenAI (its current
 * models need it for tool calling) and xAI (its primary interface).
 * Reasoning items returned alongside a function call must be sent back with
 * the call's output, so a provider's own output items are replayed verbatim.
 */

type OutputItem = { type: string; call_id?: string; name?: string; arguments?: string; content?: { type: string; text?: string }[]; [key: string]: unknown };

export interface ResponsesConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export function toResponsesInput(provider: string, messages: LLMMessage[]): { instructions: string; input: unknown[] } {
  const [first, ...rest] = messages;
  const instructions = first?.role === "system" ? first.content ?? "" : "";
  const input: unknown[] = [];
  for (const message of first?.role === "system" ? rest : messages) {
    if (message.role === "tool") {
      input.push({ type: "function_call_output", call_id: message.toolCallId ?? "", output: message.content ?? "" });
    } else if (message.role === "assistant" && message.toolCalls?.length) {
      if (message.raw?.provider === provider) input.push(...(message.raw.data as unknown[]));
      else {
        if (message.content) input.push({ role: "assistant", content: message.content });
        for (const call of message.toolCalls) input.push({ type: "function_call", call_id: call.id, name: call.name, arguments: call.arguments });
      }
    } else {
      input.push({ role: message.role, content: message.content ?? "" });
    }
  }
  return { instructions, input };
}

export function fromResponsesOutput(provider: string, body: Record<string, unknown>): LLMCompletionResult {
  const output = body.output as OutputItem[] | undefined;
  if (!Array.isArray(output)) throw new ProviderError(provider, null, "no output items");

  const text = output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  const toolCalls: LLMToolCallRequest[] = output
    .filter((item) => item.type === "function_call" && item.name && item.call_id)
    .map((item) => ({ id: item.call_id!, name: item.name!, arguments: item.arguments || "{}" }));

  return {
    content: text || null,
    toolCalls: toolCalls.length ? toolCalls : null,
    raw: toolCalls.length ? { provider, data: output } : undefined,
  };
}

export function responsesProvider(config: ResponsesConfig): LLMProvider {
  const id = `${config.provider}:${config.model}`;
  return {
    id,
    provider: config.provider,
    async complete(messages: LLMMessage[], tools: ToolDefinition[], options: ProviderCallOptions) {
      const { instructions, input } = toResponsesInput(config.provider, messages);
      const body = {
        model: config.model,
        instructions,
        input,
        ...(tools.length
          ? { tools: tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters })), tool_choice: options.toolChoice }
          : {}),
        max_output_tokens: options.maxOutputTokens,
      };
      const json = await withTimeout(id, options.timeoutMs, (signal) =>
        postJson(id, `${config.baseUrl}/responses`, { authorization: `Bearer ${config.apiKey}` }, body, signal, config.fetchImpl)
      );
      return { ...fromResponsesOutput(config.provider, json), servedBy: id };
    },
  };
}
