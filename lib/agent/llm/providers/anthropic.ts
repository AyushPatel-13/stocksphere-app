import Anthropic from "@anthropic-ai/sdk";

import type { LLMCompletionResult, LLMMessage, LLMToolCallRequest, ToolDefinition } from "../../types";
import { type LLMProvider, type ProviderCallOptions, ProviderError, withTimeout } from "./types";

/**
 * Claude via the official SDK (Messages API). Optional and paid: used only
 * when ANTHROPIC_API_KEY is set. Thinking stays adaptive (the model default);
 * its blocks are replayed unchanged when the next round also goes to Claude.
 */

type Block = Anthropic.Beta.BetaContentBlockParam;

/** Models that take the server-side refusal fallback (`fallbacks: "default"`). */
const SERVER_FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export function toAnthropicMessages(provider: string, messages: LLMMessage[]): { system: string; messages: Anthropic.Beta.BetaMessageParam[] } {
  const [first, ...rest] = messages;
  const system = first?.role === "system" ? first.content ?? "" : "";
  const out: Anthropic.Beta.BetaMessageParam[] = [];

  // Appends blocks to a user turn, merging with the previous one so all tool
  // results of one round travel in a single user message.
  const pushUser = (blocks: Block[]) => {
    const last = out[out.length - 1];
    if (last?.role === "user" && Array.isArray(last.content)) last.content.push(...blocks);
    else out.push({ role: "user", content: blocks });
  };

  for (const message of first?.role === "system" ? rest : messages) {
    if (message.role === "tool") {
      pushUser([{ type: "tool_result", tool_use_id: message.toolCallId ?? "", content: message.content ?? "" }]);
    } else if (message.role === "system") {
      // A later instruction from the orchestrator ("answer now"): added to the user turn it follows.
      pushUser([{ type: "text", text: message.content ?? "" }]);
    } else if (message.role === "assistant") {
      if (message.toolCalls?.length && message.raw?.provider === provider) {
        out.push({ role: "assistant", content: message.raw.data as Block[] });
      } else if (message.toolCalls?.length) {
        const blocks: Block[] = message.content ? [{ type: "text", text: message.content }] : [];
        for (const call of message.toolCalls) {
          let input: unknown = {};
          try {
            input = JSON.parse(call.arguments);
          } catch {
            input = {};
          }
          blocks.push({ type: "tool_use", id: call.id, name: call.name, input });
        }
        out.push({ role: "assistant", content: blocks });
      } else {
        out.push({ role: "assistant", content: message.content ?? "" });
      }
    } else {
      pushUser([{ type: "text", text: message.content ?? "" }]);
    }
  }
  return { system, messages: out };
}

export function fromAnthropicMessage(provider: string, message: Anthropic.Beta.BetaMessage): LLMCompletionResult {
  if (message.stop_reason === "refusal") throw new ProviderError(provider, null, "declined (refusal)");
  const text = message.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  const toolCalls: LLMToolCallRequest[] = message.content
    .filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use")
    .map((block) => ({ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) }));
  return {
    content: text || null,
    toolCalls: toolCalls.length ? toolCalls : null,
    raw: toolCalls.length ? { provider, data: message.content } : undefined,
  };
}

export function anthropicProvider(config: { model: string; apiKey: string; client?: Anthropic }): LLMProvider {
  const provider = "anthropic";
  const id = `${provider}:${config.model}`;
  // Retries are the chain's job (it moves to the next provider), so the SDK doesn't wait them out.
  const client = config.client ?? new Anthropic({ apiKey: config.apiKey, maxRetries: 0 });
  const serverFallback = SERVER_FALLBACK_MODELS.has(config.model);

  return {
    id,
    provider,
    async complete(messages: LLMMessage[], tools: ToolDefinition[], options: ProviderCallOptions) {
      const { system, messages: wire } = toAnthropicMessages(provider, messages);
      const response = await withTimeout(id, options.timeoutMs, (signal) =>
        client.beta.messages.create(
          {
            model: config.model,
            // Adaptive thinking spends from this budget too; the answer itself is short.
            max_tokens: 16000,
            system,
            messages: wire,
            ...(tools.length
              ? {
                  tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters as Anthropic.Beta.BetaTool.InputSchema })),
                  tool_choice: { type: options.toolChoice },
                }
              : {}),
            output_config: { effort: "medium" },
            ...(serverFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          },
          { signal }
        )
      );
      return { ...fromAnthropicMessage(provider, response), servedBy: id };
    },
  };
}
