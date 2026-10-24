import { LLMMessage, LLMCompletionResult, ToolDefinition } from "../types";
import { LLMError } from "../errors";
import { buildProviders, fallbackModel } from "./providers/registry";
import { type LLMProvider, ProviderError } from "./providers/types";

/**
 * The assistant's one entry point to a language model: tries each configured
 * provider in order (see providers/registry.ts) and returns the first answer.
 * A timeout, rate limit (429), oversize request (413), server error or bad
 * key at one provider moves on to the next. Everything outside lib/agent/llm
 * speaks LLMMessage / LLMCompletionResult.
 */

export { fallbackModel };

/** Longest a single model call may take before the next provider is tried. */
export const PROVIDER_TIMEOUT_MS = 20_000;
/** A call isn't started with less time than this left before the deadline. */
const MIN_CALL_MS = 3_000;
/** How long a rate-limited provider is skipped when it doesn't say. */
const DEFAULT_COOLDOWN_MS = 20_000;
/** Longest wait for a rate limit to clear when every provider is limited. */
const MAX_RATE_LIMIT_WAIT_MS = 15_000;
/** Passes over the chain; a rate-limit wait sits between passes. */
const MAX_PASSES = 3;
/** gpt-oss and Gemini reason before answering, and that counts against this. */
const MAX_OUTPUT_TOKENS = 2048;

export function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

/** 429: rate-limited. 413: one request above the per-minute token limit. Both are worth another model. */
export function shouldFallBack(error: unknown): boolean {
  const status = statusOf(error);
  return status === 429 || status === 413;
}

/**
 * A provider failure as a message fit for the user. Raw provider errors can
 * name the account and its upgrade links, so they are logged in short form on
 * the server and never passed through.
 */
export function toLLMError(error: unknown): LLMError {
  const status = statusOf(error);
  console.error(`LLM request failed (${status ?? "no status"}):`, error instanceof Error ? error.message.slice(0, 200) : "unknown");
  if (status === 429 && error instanceof ProviderError && error.dailyQuota) {
    return new LLMError("StockSphere AI has used its free AI quota for today. Please try again later.");
  }
  if (status === 429) return new LLMError("The AI service is busy right now. Please try again in a minute.");
  if (status === 413) return new LLMError("That question needed more data than the AI service accepts at once. Try asking about fewer items or a shorter period.");
  if (status === 401 || status === 403) return new LLMError("The AI service isn't configured correctly.");
  if (status === 400) return new LLMError("The AI service couldn't process that request. Please rephrase and try again.");
  return new LLMError("The AI service didn't respond. Please try again shortly.");
}

export interface ChatCompletionOptions {
  /**
   * "none" withholds tool calling for this one turn, so the model must answer
   * in prose from the conversation it already has. The orchestrator uses it to
   * ask for a final answer once its tool budget is spent. Defaults to "auto".
   */
  toolChoice?: "auto" | "none";
  /** Epoch ms by which the call must be finished; no provider is started after it. */
  deadline?: number;
}

export interface ChainDeps {
  providers: LLMProvider[];
  now: () => number;
  /** Provider id → epoch ms until which it is skipped after a rate limit. Shared across requests. */
  cooldowns: Map<string, number>;
  sleep: (ms: number) => Promise<void>;
}

const sharedCooldowns = new Map<string, number>();
let cachedProviders: LLMProvider[] | null = null;

function defaultDeps(): ChainDeps {
  cachedProviders ??= buildProviders();
  return { providers: cachedProviders, now: Date.now, cooldowns: sharedCooldowns, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
}

/**
 * Providers to try, in order: those not cooling down first; cooling ones
 * after, soonest-available first, so a single configured provider is still
 * tried when it is the only one.
 */
export function orderForAttempt(providers: LLMProvider[], cooldowns: Map<string, number>, now: number): LLMProvider[] {
  const ready = providers.filter((p) => (cooldowns.get(p.id) ?? 0) <= now);
  const cooling = providers.filter((p) => (cooldowns.get(p.id) ?? 0) > now).sort((a, b) => cooldowns.get(a.id)! - cooldowns.get(b.id)!);
  return [...ready, ...cooling];
}

export async function getChatCompletion(
  messages: LLMMessage[],
  tools: ToolDefinition[],
  options: ChatCompletionOptions = {},
  deps: ChainDeps = defaultDeps()
): Promise<LLMCompletionResult> {
  if (deps.providers.length === 0) {
    throw new LLMError("No AI provider is configured on the server (set GEMINI_API_KEY or GROQ_API_KEY).");
  }

  let lastError: unknown = null;
  // When every provider was rate-limited, the shortest wait any of them asked
  // for (capped) is waited out and the chain tried again, as long as the
  // deadline allows — this matters when Groq is the only provider configured.
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let allRateLimited = true;
    for (const provider of orderForAttempt(deps.providers, deps.cooldowns, deps.now())) {
      const remaining = (options.deadline ?? Infinity) - deps.now();
      if (remaining < MIN_CALL_MS) break;

      try {
        const result = await provider.complete(messages, tools, {
          toolChoice: options.toolChoice ?? "auto",
          timeoutMs: Math.min(PROVIDER_TIMEOUT_MS, remaining),
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        });
        deps.cooldowns.delete(provider.id);
        return result;
      } catch (error) {
        lastError = error;
        const status = statusOf(error);
        console.error(`LLM provider ${provider.id} failed (${status ?? "no status"}): ${error instanceof Error ? error.message.slice(0, 160) : "unknown"}`);
        if (status === 429) {
          const wait = error instanceof ProviderError && error.retryAfterSec ? error.retryAfterSec * 1000 : DEFAULT_COOLDOWN_MS;
          deps.cooldowns.set(provider.id, deps.now() + wait);
        } else {
          allRateLimited = false;
        }
      }
    }

    if (pass === MAX_PASSES - 1 || !allRateLimited || lastError === null) break;
    const soonest = Math.min(...deps.providers.map((p) => deps.cooldowns.get(p.id) ?? 0)) - deps.now();
    // A limit that won't clear soon (a spent daily quota) isn't waited on.
    if (soonest > MAX_RATE_LIMIT_WAIT_MS) break;
    const wait = Math.max(0, soonest);
    if ((options.deadline ?? Infinity) - deps.now() - wait < MIN_CALL_MS) break;
    await deps.sleep(wait);
  }

  throw toLLMError(lastError ?? Object.assign(new Error("deadline reached before any provider answered"), { status: null }));
}

/** The configured chain as "gemini:gemini-3.8-flash → groq:…", for logs and the status check. No keys. */
export function describeProviders(): string {
  return defaultDeps().providers.map((p) => p.id).join(" → ") || "none";
}
