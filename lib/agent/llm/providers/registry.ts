import type { LLMProvider } from "./types";
import { chatCompletionsProvider } from "./chatCompletions";
import { responsesProvider } from "./responses";
import { anthropicProvider } from "./anthropic";

/**
 * Which providers the assistant may use, in order. Free tiers first:
 *
 *   gemini      GEMINI_API_KEY      Google AI Studio free tier   (GEMINI_MODEL, default gemini-3.8-flash)
 *   groq        GROQ_API_KEY        Groq free plan               (GROQ_MODEL, then GROQ_FALLBACK_MODEL)
 *   openrouter  OPENROUTER_API_KEY  OpenRouter free models       (OPENROUTER_MODEL, default openrouter/free)
 *   anthropic   ANTHROPIC_API_KEY   paid                         (ANTHROPIC_MODEL, default claude-opus-5-5)
 *   openai      OPENAI_API_KEY      paid                         (OPENAI_MODEL, default gpt-6-astra)
 *   xai         XAI_API_KEY         paid                         (XAI_MODEL, default grok-4.7)
 *
 * LLM_PROVIDERS ("groq,gemini") overrides the order and can leave providers
 * out. A provider without its key is skipped, so with only GROQ_API_KEY set
 * the assistant runs on Groq alone. Model defaults were taken from each
 * provider's documentation in October 2026; override them by env var.
 */

export const DEFAULT_ORDER = ["gemini", "groq", "openrouter", "anthropic", "openai", "xai"] as const;
export type ProviderName = (typeof DEFAULT_ORDER)[number];

type Env = Record<string, string | undefined>;

/** Groq's second model, used when the first is over its per-minute limit. "none" disables. */
export function fallbackModel(env: string | undefined = process.env.GROQ_FALLBACK_MODEL): string | null {
  if (env === "none") return null;
  return env || "openai/gpt-oss-20b";
}

export function providerOrder(env: Env): ProviderName[] {
  const raw = env.LLM_PROVIDERS?.trim();
  if (!raw) return [...DEFAULT_ORDER];
  const names = raw.split(",").map((name) => name.trim().toLowerCase());
  return names.filter((name, index): name is ProviderName => (DEFAULT_ORDER as readonly string[]).includes(name) && names.indexOf(name) === index);
}

function build(name: ProviderName, env: Env): LLMProvider[] {
  switch (name) {
    case "gemini": {
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) return [];
      return [chatCompletionsProvider({ provider: "gemini", model: env.GEMINI_MODEL || "gemini-3.8-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey })];
    }
    case "groq": {
      const apiKey = env.GROQ_API_KEY;
      if (!apiKey) return [];
      const main = env.GROQ_MODEL || "openai/gpt-oss-120b";
      const second = fallbackModel(env.GROQ_FALLBACK_MODEL);
      // Each Groq model has its own per-minute token allowance.
      return [main, ...(second && second !== main ? [second] : [])].map((model) =>
        chatCompletionsProvider({ provider: "groq", model, baseUrl: "https://api.groq.com/openai/v1", apiKey, temperature: 0.2, maxOutputTokens: 1024 })
      );
    }
    case "openrouter": {
      const apiKey = env.OPENROUTER_API_KEY;
      if (!apiKey) return [];
      return [
        chatCompletionsProvider({
          provider: "openrouter",
          model: env.OPENROUTER_MODEL || "openrouter/free",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey,
          temperature: 0.2,
          extraHeaders: { "X-Title": "StockSphere" },
        }),
      ];
    }
    case "anthropic": {
      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey) return [];
      return [anthropicProvider({ model: env.ANTHROPIC_MODEL || "claude-opus-5-5", apiKey })];
    }
    case "openai": {
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey) return [];
      return [responsesProvider({ provider: "openai", model: env.OPENAI_MODEL || "gpt-6-astra", baseUrl: "https://api.openai.com/v1", apiKey })];
    }
    case "xai": {
      const apiKey = env.XAI_API_KEY;
      if (!apiKey) return [];
      return [responsesProvider({ provider: "xai", model: env.XAI_MODEL || "grok-4.7", baseUrl: "https://api.x.ai/v1", apiKey })];
    }
  }
}

/** The configured chain. Never logs or returns keys. */
export function buildProviders(env: Env = process.env): LLMProvider[] {
  return providerOrder(env).flatMap((name) => build(name, env));
}
