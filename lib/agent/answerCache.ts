import type { AgentResponse } from "@/lib/types/agent";

/**
 * Short-lived cache of complete answers to stand-alone questions (no earlier
 * turns), keyed by the normalised question. The same question asked again
 * within the TTL — a suggested prompt clicked twice, two people asking "how is
 * the market" — costs no model tokens, which matters on Groq's free tier.
 *
 * Only clean answers are kept: anything that came back with warnings (missing
 * data, a cut-short run) is asked fresh next time. Per server instance.
 */

export const ANSWER_TTL_MS = 2 * 60_000;
const MAX_ENTRIES = 200;

export function normaliseQuestion(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%.&$ ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createAnswerCache(now: () => number = Date.now) {
  const entries = new Map<string, { at: number; response: AgentResponse }>();

  return {
    get(message: string): AgentResponse | null {
      const key = normaliseQuestion(message);
      const hit = entries.get(key);
      if (!hit) return null;
      if (now() - hit.at > ANSWER_TTL_MS) {
        entries.delete(key);
        return null;
      }
      return hit.response;
    },

    set(message: string, response: AgentResponse): void {
      if (response.warnings.length > 0 || !response.answer.trim()) return;
      if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
      entries.set(normaliseQuestion(message), { at: now(), response });
    },
  };
}

export const answerCache = createAnswerCache();
