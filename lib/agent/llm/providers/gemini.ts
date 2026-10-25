import { ApiError, type Content, FunctionCallingConfigMode, GoogleGenAI, type GenerateContentResponse, type Part, ThinkingLevel } from "@google/genai";

import type { LLMCompletionResult, LLMMessage, LLMToolCallRequest, ToolDefinition } from "../../types";
import { DAILY_QUOTA_COOLDOWN_SEC, type LLMProvider, type ProviderCallOptions, ProviderError, isDailyQuota, withTimeout } from "./types";

/**
 * Gemini via the official SDK (@google/genai, generateContent). Optional:
 * used only when GEMINI_API_KEY is set, and only on the server. Gemini's own
 * model turns are replayed unchanged so the thought signatures it attaches to
 * function calls survive; tool turns that came from another provider are
 * replayed as plain text, since they carry no signature.
 */

type ModelsClient = Pick<GoogleGenAI["models"], "generateContent">;

/** Ids we made up for calls Gemini sent without one; never sent back as ids. */
const SYNTHETIC_ID = /^gemini_call_\d+$/;

export function toGeminiContents(provider: string, messages: LLMMessage[]): { systemInstruction: string; contents: Content[] } {
  const [first, ...rest] = messages;
  const systemInstruction = first?.role === "system" ? first.content ?? "" : "";
  const contents: Content[] = [];
  // Tool call id → function name, from earlier assistant turns: functionResponse needs the name.
  const names = new Map<string, string>();
  // Tool call ids answered as text because their call came from another provider.
  const foreign = new Set<string>();

  // Appends parts to a turn of `role`, merging with the previous one so all
  // tool results of one round travel in a single user turn.
  const push = (role: "user" | "model", parts: Part[]) => {
    const last = contents[contents.length - 1];
    if (last?.role === role) last.parts!.push(...parts);
    else contents.push({ role, parts });
  };

  for (const message of first?.role === "system" ? rest : messages) {
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) names.set(call.id, call.name);
      if (message.toolCalls?.length && message.raw?.provider === provider) {
        push("model", [...(message.raw.data as Content).parts!]);
      } else if (message.toolCalls?.length) {
        for (const call of message.toolCalls) foreign.add(call.id);
        const calls = message.toolCalls.map((call) => `Called ${call.name} with ${call.arguments}`).join("\n");
        push("model", [{ text: [message.content, calls].filter(Boolean).join("\n") }]);
      } else {
        push("model", [{ text: message.content ?? "" }]);
      }
    } else if (message.role === "tool") {
      const id = message.toolCallId ?? "";
      const name = names.get(id) ?? "tool";
      if (foreign.has(id)) {
        push("user", [{ text: `Result of ${name}: ${message.content ?? ""}` }]);
      } else {
        push("user", [{ functionResponse: { ...(SYNTHETIC_ID.test(id) ? {} : { id }), name, response: { result: message.content ?? "" } } }]);
      }
    } else {
      // User turns, and later orchestrator instructions ("answer now"), which ride on the user turn.
      push("user", [{ text: message.content ?? "" }]);
    }
  }
  return { systemInstruction, contents };
}

const BLOCKED = new Set(["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "RECITATION"]);

export function fromGeminiResponse(provider: string, response: GenerateContentResponse): LLMCompletionResult {
  if (response.promptFeedback?.blockReason) throw new ProviderError(provider, null, `blocked (${response.promptFeedback.blockReason})`);
  const candidate = response.candidates?.[0];
  if (!candidate) throw new ProviderError(provider, null, "no response candidates");
  if (candidate.finishReason && BLOCKED.has(candidate.finishReason)) throw new ProviderError(provider, null, `blocked (${candidate.finishReason})`);

  const parts = candidate.content?.parts ?? [];
  // Thought summaries are left out of the answer; only the visible text counts.
  const text = parts.filter((part) => typeof part.text === "string" && !part.thought).map((part) => part.text).join("");
  const toolCalls: LLMToolCallRequest[] = parts
    .filter((part) => part.functionCall?.name)
    .map((part, index) => ({ id: part.functionCall!.id || `gemini_call_${index}`, name: part.functionCall!.name!, arguments: JSON.stringify(part.functionCall!.args ?? {}) }));

  return {
    content: text || null,
    toolCalls: toolCalls.length ? toolCalls : null,
    // The whole model turn, thought signatures included, for replay to Gemini.
    raw: toolCalls.length ? { provider, data: { role: "model", parts } satisfies Content } : undefined,
  };
}

/**
 * An SDK ApiError as ProviderError. Its message is the API's JSON error body:
 * a spent daily quota names a "...PerDay..." quota id, and RetryInfo gives the
 * wait as "retryDelay": "34s". The excerpt kept for the server log has project
 * numbers and the key itself stripped.
 */
export function toProviderError(providerId: string, error: ApiError, apiKey: string): ProviderError {
  const message = error.message;
  const delay = Number(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message)?.[1]);
  const wait = Number.isFinite(delay) && delay > 0 ? Math.ceil(delay) : null;
  const daily = error.status === 429 && (isDailyQuota(message) || /PerDay/.test(message));
  const excerpt = (apiKey ? message.split(apiKey).join("…") : message).replace(/projects\/\d+/g, "projects/…").slice(0, 200);
  return new ProviderError(providerId, error.status, excerpt, daily ? Math.max(wait ?? 0, DAILY_QUOTA_COOLDOWN_SEC) : wait, daily);
}

export function geminiProvider(config: { model: string; apiKey: string; client?: ModelsClient }): LLMProvider {
  const provider = "gemini";
  const id = `${provider}:${config.model}`;
  // Retries are the chain's job (it moves to the next provider), so the SDK doesn't wait them out.
  const models = config.client ?? new GoogleGenAI({ apiKey: config.apiKey, httpOptions: { retryOptions: { attempts: 1 } } }).models;

  return {
    id,
    provider,
    async complete(messages: LLMMessage[], tools: ToolDefinition[], options: ProviderCallOptions) {
      const { systemInstruction, contents } = toGeminiContents(provider, messages);
      const response = await withTimeout(id, options.timeoutMs, async (signal) => {
        try {
          return await models.generateContent({
            model: config.model,
            contents,
            config: {
              abortSignal: signal,
              ...(systemInstruction ? { systemInstruction } : {}),
              // Thinking spends from the output budget; low leaves room for the answer.
              maxOutputTokens: options.maxOutputTokens,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              ...(tools.length
                ? {
                    tools: [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters })) }],
                    toolConfig: { functionCallingConfig: { mode: options.toolChoice === "none" ? FunctionCallingConfigMode.NONE : FunctionCallingConfigMode.AUTO } },
                  }
                : {}),
            },
          });
        } catch (error) {
          if (error instanceof ApiError) throw toProviderError(id, error, config.apiKey);
          throw error;
        }
      });
      return { ...fromGeminiResponse(provider, response), servedBy: id };
    },
  };
}
