import { randomUUID } from "node:crypto";
import { AGENT_TOOLS, getToolByName } from "./tools";
import { getChatCompletion as defaultGetChatCompletion } from "./llm/client";
import { AGENT_SYSTEM_PROMPT, dateContext } from "./llm/prompts";
import { LLMError } from "./errors";
import { LLMMessage, ToolResult } from "./types";
import { AgentRequest, AgentResponse, AgentToolCallTrace, AgentMessage } from "@/lib/types/agent";

// The LLM call is injectable (defaulting to the real provider chain) so
// the tool-calling loop itself can be exercised in tests without making a
// real network call. Callers outside tests never need to pass `deps`.
export interface RunAgentDeps {
  getChatCompletion: typeof defaultGetChatCompletion;
  /** Clock, injectable for tests. */
  now?: () => number;
  /** Overall budget for gathering data, in ms (default AGENT_BUDGET_MS). */
  budgetMs?: number;
  /** Hard limit for the whole request, in ms (default AGENT_DEADLINE_MS). */
  deadlineMs?: number;
  /** Longest one tool may run, in ms (default TOOL_TIMEOUT_MS). */
  toolTimeoutMs?: number;
}

/**
 * Once this much time has gone on tool rounds, no more data is gathered: the
 * model answers from what it already has (the reserved final turn below).
 * A live two-stock comparison took 83s, and one attempt passed 90s, before
 * this existed.
 */
export const AGENT_BUDGET_MS = 30_000;

/**
 * The whole request, final answer included, ends within this. The browser
 * gives up at 65 s (lib/agent/client/request.ts) and the route allows 60 s
 * (maxDuration), so a slow provider now produces a partial answer from the
 * data already fetched instead of "took too long to respond". A production
 * follow-up ("Jio financials") hit that timeout.
 */
export const AGENT_DEADLINE_MS = 50_000;

/** Time kept back from tool rounds for the final answer. */
const FINAL_ANSWER_RESERVE_MS = 12_000;

/** A data source that hangs is answered as unavailable after this long. */
export const TOOL_TIMEOUT_MS = 12_000;

export async function executeWithTimeout(run: () => Promise<ToolResult<unknown>>, source: string, timeoutMs: number): Promise<ToolResult<unknown>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ToolResult<unknown>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, data: null, source, fetchedAt: new Date().toISOString() }), timeoutMs);
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// How many turns may request tools.
//
// This is a budget of *tool calls*, not of rounds. The model asks for one tool
// per turn far more often than it batches them, so the previous cap of five
// bought exactly five tool calls: a single-stock price question fits in that,
// and a two-stock comparison does not. A live "Compare TCS and Infosys."
// stopped at five having resolved both companies and priced only the first.
//
// Raising the number is a small part of the fix and would be worthless alone —
// it only moves the wall the request dies against. It is paired with three
// changes that make the rounds go further: the system prompt now asks for
// independent calls together in one turn, an identical call is answered from
// the first result instead of being re-fetched, and the final answer is no
// longer one of the rounds being spent (see the reserved turn at the bottom).
const MAX_TOOL_ROUNDS = 8;

const FALLBACK_ANSWER =
  "I wasn't able to finish gathering the data needed to answer that. Please try rephrasing your question or asking about one stock at a time.";

function buildInitialMessages(
  history: AgentMessage[] | undefined,
  message: string,
  now: Date
): LLMMessage[] {
  const messages: LLMMessage[] = [{ role: "system", content: `${AGENT_SYSTEM_PROMPT}

${dateContext(now)}` }];

  for (const entry of history ?? []) {
    messages.push({ role: entry.role, content: entry.content });
  }

  messages.push({ role: "user", content: message });

  return messages;
}

export async function runAgent(
  request: AgentRequest,
  deps: RunAgentDeps = { getChatCompletion: defaultGetChatCompletion }
): Promise<AgentResponse> {
  const conversationId = request.conversationId ?? randomUUID();
  const now = deps.now ?? Date.now;
  const messages = buildInitialMessages(request.history, request.message, new Date(now()));

  const toolCallTrace: AgentToolCallTrace[] = [];
  const sources = new Set<string>();
  const warnings: string[] = [];

  // Identical (tool, arguments) pairs already fetched during this request.
  // Re-running one can only re-fetch what the model has already been given,
  // and every repeat spends a round that a comparison needs elsewhere.
  const fetched = new Map<string, ToolResult<unknown>>();

  const startedAt = now();
  const budgetMs = deps.budgetMs ?? AGENT_BUDGET_MS;
  const deadline = startedAt + (deps.deadlineMs ?? AGENT_DEADLINE_MS);
  const toolTimeoutMs = deps.toolTimeoutMs ?? TOOL_TIMEOUT_MS;
  // Set when the model answered with nothing at all (gpt-oss can spend its
  // whole output budget reasoning): it is asked once more, below.
  let emptyReply = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (round > 0 && now() - startedAt > budgetMs) {
      warnings.push("Stopped gathering data to answer in time; the answer uses what was retrieved.");
      break;
    }

    let completion;
    try {
      completion = await deps.getChatCompletion(messages, AGENT_TOOLS, { deadline: deadline - FINAL_ANSWER_RESERVE_MS });
    } catch (error) {
      // A provider failure after data was gathered (usually the per-minute
      // token limit) should not throw away what was fetched: list it instead.
      // With nothing gathered yet there is nothing to show, so it propagates.
      const gathered = summariseGathered(fetched);
      if (!gathered || !(error instanceof LLMError)) throw error;
      warnings.push("The AI service stopped responding part-way; the answer lists the data that was retrieved.");
      return {
        answer: gathered,
        toolCalls: toolCallTrace,
        sources: Array.from(sources),
        warnings,
        conversationId,
      };
    }

    if (!completion.toolCalls || completion.toolCalls.length === 0) {
      if (!completion.content?.trim()) {
        emptyReply = true;
        break;
      }
      return {
        answer: completion.content.trim(),
        toolCalls: toolCallTrace,
        sources: Array.from(sources),
        warnings,
        conversationId,
      };
    }

    // Record the assistant's tool-call request before the results, so the
    // conversation sent back to the LLM stays in the shape it expects.
    messages.push({
      role: "assistant",
      content: completion.content,
      toolCalls: completion.toolCalls,
      raw: completion.raw,
    });

    for (const call of completion.toolCalls) {
      const tool = getToolByName(call.name);

      if (!tool) {
        warnings.push(`The assistant tried to use an unknown tool "${call.name}".`);
        toolCallTrace.push({
          tool: call.name,
          input: {},
          ok: false,
          source: call.name,
        });
        messages.push({
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify({
            ok: false,
            data: null,
            source: call.name,
            fetchedAt: new Date().toISOString(),
          }),
        });
        continue;
      }

      let rawArgs: unknown = {};
      try {
        rawArgs = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        rawArgs = {};
      }

      const validation = tool.argsSchema.safeParse(rawArgs);

      let result: ToolResult<unknown>;
      let inputForTrace: Record<string, unknown> = {};

      if (!validation.success) {
        warnings.push(`Invalid arguments were provided to "${tool.name}".`);
        result = {
          ok: false,
          data: null,
          source: tool.name,
          fetchedAt: new Date().toISOString(),
        };
      } else {
        inputForTrace = validation.data as Record<string, unknown>;

        // The same tool with the same arguments, already run in this request.
        // The tool message still has to be answered — every tool_call id needs
        // a reply — so the earlier result is replayed to the model, and no
        // second chip is recorded, because no second fetch happened.
        const cacheKey = `${tool.name}:${JSON.stringify(inputForTrace)}`;
        const previously = fetched.get(cacheKey);

        if (previously) {
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: serialiseForModel(previously),
          });
          continue;
        }

        result = await executeWithTimeout(() => tool.execute(validation.data), tool.name, toolTimeoutMs);
        fetched.set(cacheKey, result);
      }

      toolCallTrace.push({
        tool: tool.name,
        input: inputForTrace,
        ok: result.ok,
        source: result.source,
      });

      if (result.ok) {
        sources.add(result.source);
      } else {
        warnings.push(
          `No data was available from "${tool.name}" for the requested input.`
        );
      }

      messages.push({
        role: "tool",
        toolCallId: call.id,
        content: serialiseForModel(result),
      });
    }
  }

  // The tool budget is spent, but everything gathered so far is real and is
  // already sitting in `messages`. Ending here would throw it away and tell the
  // user the agent "wasn't able to finish gathering the data" while it is
  // holding both companies' figures — which is exactly what the live
  // "Compare TCS and Infosys." did, with nine tool results in hand.
  //
  // So the last word goes to the model, once, with tool calling withheld: it
  // must answer from what it has, and say plainly which values it could not
  // retrieve. Nothing is invented here — the same tool results are all it can
  // see, and its instructions not to guess are unchanged.
  // Said explicitly: the prompt tells the model to use the calculate tool for
  // every percentage, and with tools withheld it would otherwise try anyway
  // (Groq rejects that turn with tool_use_failed).
  messages.push({
    role: "system",
    content: emptyReply
      ? "Your last reply was empty. Answer the user's question now in prose, using the tool results above for any figures and general knowledge for concepts. Where a figure was not computed by the calculate tool, give the raw values rather than working it out yourself."
      : "No more tool calls are possible. Answer now using only the tool results above. Where a figure was not computed by the calculate tool, give the raw values it would use and say the calculation wasn't run, rather than working it out yourself.",
  });

  try {
    const finalCompletion = await deps.getChatCompletion(messages, AGENT_TOOLS, {
      toolChoice: "none",
      deadline,
    });
    const finalAnswer = finalCompletion.content?.trim();

    if (finalAnswer) {
      return {
        answer: finalAnswer,
        toolCalls: toolCallTrace,
        sources: Array.from(sources),
        warnings,
        conversationId,
      };
    }
  } catch (error) {
    // A provider that rejects the withheld-tool turn must not turn a partial
    // answer into a 500; fall through to the same fallback as before.
    console.error("Agent: the reserved final-answer turn failed:", error);
  }

  warnings.push(
    "Reached the maximum number of tool-calling steps before producing a final answer."
  );

  return {
    answer: summariseGathered(fetched) ?? FALLBACK_ANSWER,
    toolCalls: toolCallTrace,
    sources: Array.from(sources),
    warnings,
    conversationId,
  };
}

/**
 * Most characters of one tool result sent to the model (~2,000 tokens). Groq's
 * free tier allows 8,000 tokens a minute and rejects any single request above
 * that (413), which a 500-candle history used to cause on its own.
 */
export const MAX_TOOL_RESULT_CHARS = 8_000;

/**
 * A tool result as JSON, cut to MAX_TOOL_RESULT_CHARS by dropping the oldest
 * entries of its longest list (history is ascending, so the most recent data
 * is kept) and saying so in `truncated`. Values are never altered.
 */
export function serialiseForModel(result: ToolResult<unknown>, maxChars: number = MAX_TOOL_RESULT_CHARS): string {
  let json = JSON.stringify(result);
  if (json.length <= maxChars || !result.data || typeof result.data !== "object") return json;

  const data = { ...(result.data as Record<string, unknown>) };
  const isList = Array.isArray(result.data);
  const listKey = isList
    ? null
    : Object.keys(data)
        .filter((key) => Array.isArray(data[key]))
        .sort((a, b) => JSON.stringify(data[b]).length - JSON.stringify(data[a]).length)[0];
  const original = (isList ? result.data : listKey ? data[listKey] : null) as unknown[] | null;
  if (!original || original.length < 2) return json;

  let keep = original.length;
  while (keep > 1) {
    keep = Math.max(1, Math.floor(keep * 0.7));
    const slice = original.slice(-keep);
    const note = `Only the last ${keep} of ${original.length} entries are shown, to fit the AI service's size limit.`;
    const shrunk = isList
      ? { ...result, data: slice, truncated: note }
      : { ...result, data: { ...data, [listKey as string]: slice, truncated: note } };
    json = JSON.stringify(shrunk);
    if (json.length <= maxChars) break;
  }
  return json;
}

/**
 * When no final answer could be generated, the facts already retrieved are
 * still real: list the prices and completed calculations verbatim (no model
 * involved), so the user gets them instead of only an apology. Null when
 * there is nothing worth listing.
 */
export function summariseGathered(fetched: Map<string, ToolResult<unknown>>): string | null {
  const lines: string[] = [];

  for (const [key, result] of fetched) {
    if (!result.ok || !result.data) continue;
    const tool = key.slice(0, key.indexOf(":"));
    const data = result.data as Record<string, unknown>;

    if (tool === "get_price" && typeof data.price === "number") {
      const change = typeof data.changePercent === "number" ? ` (${data.changePercent >= 0 ? "+" : ""}${data.changePercent.toFixed(2)}% today)` : "";
      lines.push(`- ${String(data.symbol ?? "")}: ${data.price} ${String(data.currency ?? "")}${change}`);
    }
    if (tool === "get_market_quotes" && Array.isArray(data.quotes)) {
      for (const q of data.quotes as Record<string, unknown>[]) {
        if (typeof q.price !== "number") continue;
        const unit = q.unit === "percent" ? "%" : q.currency ? ` ${String(q.currency)}` : "";
        const change = typeof q.changePercent === "number" ? ` (${q.changePercent >= 0 ? "+" : ""}${q.changePercent.toFixed(2)}% today)` : "";
        lines.push(`- ${String(q.name ?? q.symbol)}: ${q.price}${unit}${change}`);
      }
    }
    if (tool === "get_performance" && Array.isArray(data.rows)) {
      for (const row of data.rows as Record<string, unknown>[]) {
        if (row.status !== "ok" || typeof row.returnPct !== "number") continue;
        lines.push(`- ${String(row.symbol)}: ${row.startClose} (${String(row.startDate)}) → ${row.endClose} (${String(row.endDate)}), ${row.returnPct >= 0 ? "+" : ""}${row.returnPct}% over ${String(data.period)}`);
      }
    }
    if (tool === "calculate" && typeof data.rounded === "number" && Array.isArray(data.inputs)) {
      const unit = data.unit === "percent" ? "%" : "";
      lines.push(`- ${String(data.operation).replace(/_/g, " ")} of ${(data.inputs as number[]).join(" → ")}: ${data.rounded}${unit}`);
    }
  }

  if (lines.length === 0) return null;
  return [
    "I ran out of time before writing a full answer (the AI service is rate-limited right now). Here is what I did retrieve:",
    "",
    ...lines,
    "",
    "Prices are the latest StockSphere had and may be delayed.",
  ].join("\n");
}
