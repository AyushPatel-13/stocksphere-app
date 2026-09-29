import { randomUUID } from "node:crypto";
import { AGENT_TOOLS, getToolByName } from "./tools";
import { getChatCompletion as defaultGetChatCompletion } from "./llm/client";
import { AGENT_SYSTEM_PROMPT } from "./llm/prompts";
import { LLMMessage, ToolResult } from "./types";
import { AgentRequest, AgentResponse, AgentToolCallTrace, AgentMessage } from "@/lib/types/agent";

// The LLM call is injectable (defaulting to the real Groq-backed client) so
// the tool-calling loop itself can be exercised in tests without making a
// real network call. Callers outside tests never need to pass `deps`.
export interface RunAgentDeps {
  getChatCompletion: typeof defaultGetChatCompletion;
}

const MAX_ITERATIONS = 5;

const FALLBACK_ANSWER =
  "I wasn't able to finish gathering the data needed to answer that. Please try rephrasing your question or asking about one stock at a time.";

function buildInitialMessages(
  history: AgentMessage[] | undefined,
  message: string
): LLMMessage[] {
  const messages: LLMMessage[] = [{ role: "system", content: AGENT_SYSTEM_PROMPT }];

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
  const messages = buildInitialMessages(request.history, request.message);

  const toolCallTrace: AgentToolCallTrace[] = [];
  const sources = new Set<string>();
  const warnings: string[] = [];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const completion = await deps.getChatCompletion(messages, AGENT_TOOLS);

    if (!completion.toolCalls || completion.toolCalls.length === 0) {
      return {
        answer: completion.content?.trim() || FALLBACK_ANSWER,
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
        result = await tool.execute(validation.data);
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
        content: JSON.stringify(result),
      });
    }
  }

  warnings.push(
    "Reached the maximum number of tool-calling steps before producing a final answer."
  );

  return {
    answer: FALLBACK_ANSWER,
    toolCalls: toolCallTrace,
    sources: Array.from(sources),
    warnings,
    conversationId,
  };
}
