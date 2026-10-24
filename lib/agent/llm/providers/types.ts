import type { LLMCompletionResult, LLMMessage, ToolDefinition } from "../../types";

export interface ProviderCallOptions {
  toolChoice: "auto" | "none";
  /** Abort the call after this many ms. */
  timeoutMs: number;
  maxOutputTokens: number;
}

/**
 * One model at one provider. Everything outside lib/agent/llm speaks
 * LLMMessage / LLMCompletionResult; each provider translates to its own wire
 * format. A failure is thrown as ProviderError so the chain can fall through.
 */
export interface LLMProvider {
  /** "gemini:gemini-3.8-flash" — provider id plus model, for logs and tracing. */
  id: string;
  /** Provider id alone ("gemini"), which ProviderRaw.provider is matched on. */
  provider: string;
  complete(messages: LLMMessage[], tools: ToolDefinition[], options: ProviderCallOptions): Promise<LLMCompletionResult>;
}

/** A provider call that failed. `status` is the HTTP status when there was one. */
export class ProviderError extends Error {
  constructor(
    readonly providerId: string,
    readonly status: number | null,
    message: string,
    /** Seconds the provider asked us to wait (429), when it said. */
    readonly retryAfterSec: number | null = null,
    /** True when a daily (not per-minute) quota is used up. */
    readonly dailyQuota: boolean = false
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** How long a provider whose daily quota is spent is skipped. */
export const DAILY_QUOTA_COOLDOWN_SEC = 15 * 60;

/** Rate-limit messages that mean a per-day quota (Groq "tokens per day (TPD)", "requests per day"; Gemini/OpenRouter "per day"). */
export function isDailyQuota(message: string): boolean {
  return /per day|\bTPD\b|\bRPD\b|daily/i.test(message);
}

/** Run `fn` with an AbortSignal that fires after `timeoutMs`; a timeout becomes ProviderError(status null). */
export async function withTimeout<T>(providerId: string, timeoutMs: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) throw new ProviderError(providerId, null, `timed out after ${timeoutMs} ms`);
    const status = (error as { status?: unknown })?.status;
    throw new ProviderError(providerId, typeof status === "number" ? status : null, error instanceof Error ? error.message.slice(0, 200) : "request failed");
  } finally {
    clearTimeout(timer);
  }
}

/** POST JSON and return the parsed body, or throw ProviderError with the status and a short message. */
export async function postJson(providerId: string, url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    // Provider error bodies can name the account; keep a short excerpt for the server log only.
    const text = (await response.text().catch(() => "")).replace(/org_[A-Za-z0-9]+/g, "org_…");
    const retryAfter = Number(response.headers.get("retry-after"));
    // A daily quota (Groq: "tokens per day (TPD)") won't clear in seconds:
    // skip the provider for a long while instead of waiting on it.
    const daily = response.status === 429 && isDailyQuota(text);
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null;
    throw new ProviderError(providerId, response.status, text.slice(0, 200), daily ? Math.max(wait ?? 0, DAILY_QUOTA_COOLDOWN_SEC) : wait, daily);
  }
  return (await response.json()) as Record<string, unknown>;
}
