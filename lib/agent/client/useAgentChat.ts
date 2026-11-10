"use client";

import { useCallback, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";
import type { AgentMessage } from "@/lib/types/agent";
import { buildHistory, composeMessage, maxQuestionLength } from "./contract";
import { AgentRequestError, sendAgentMessage } from "./request";
import type { ChatFailure, ChatMessage } from "./types";

/** Remembered per browser, so the member is asked once here and can clear it with their site data. */
export const PORTFOLIO_CONSENT_KEY = "stocksphere.ai.portfolioConsent";

function hasPortfolioConsent(): boolean {
  try {
    return window.localStorage.getItem(PORTFOLIO_CONSENT_KEY) === "yes";
  } catch {
    return false;
  }
}

let messageCounter = 0;

function nextId(role: string): string {
  messageCounter += 1;
  return `${role}-${messageCounter}`;
}

export interface UseAgentChatOptions {
  /** Canonical symbol of the stock page the panel was opened from, if any. */
  symbol?: string | null;
  /** Injected for tests; production always uses the real endpoint. */
  send?: typeof sendAgentMessage;
}

export interface UseAgentChat {
  messages: ChatMessage[];
  isSending: boolean;
  failure: ChatFailure | null;
  inputLimit: number;
  send: (text: string) => void;
  retry: () => void;
  reset: () => void;
  /** Answer the portfolio notice: allow re-asks the question with consent; decline leaves a note. */
  answerConsent: (allow: boolean) => void;
}

/**
 * Conversation state for the agent panel.
 *
 * Holds the transcript, the in-flight flag and the last failure. The transcript
 * lives here rather than inside the panel so it survives the panel being closed
 * and reopened, and so a re-render of the stock page's other data cannot touch
 * it — the agent's state is isolated from the page around it.
 *
 * Every turn goes to the existing POST /api/agent; nothing here re-implements
 * the orchestrator, and no provider is called from the browser.
 */
export function useAgentChat({
  symbol,
  send: sendTurn = sendAgentMessage,
}: UseAgentChatOptions = {}): UseAgentChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [failure, setFailure] = useState<ChatFailure | null>(null);

  // The server issues the conversation id on the first response and it is
  // echoed back on every later turn, so the agent keeps one thread.
  const conversationId = useRef<string | undefined>(undefined);
  // Guards against a second send while the first is in flight — the button is
  // disabled, but Enter is not the only way in, and the agent's rate limit is
  // low enough that a double-submit is worth preventing at the source.
  const inFlight = useRef(false);
  // Mirrors `messages` for the async send, which must not read a stale closure.
  const transcript = useRef<ChatMessage[]>([]);

  // Consent given in this panel, for when localStorage is unavailable.
  const consented = useRef(false);

  const runTurn = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || inFlight.current) return;

      inFlight.current = true;
      setIsSending(true);
      setFailure(null);

      const wire = composeMessage(question, symbol);

      const userTurn: ChatMessage = {
        id: nextId("user"),
        role: "user",
        content: question,
        wire,
      };

      const priorTurns = transcript.current;
      transcript.current = [...priorTurns, userTurn];
      setMessages(transcript.current);

      // History is every earlier turn, in wire form. The turn being sent travels
      // in `message`, which is where the orchestrator appends it.
      const history: AgentMessage[] = buildHistory(
        priorTurns.map((turn) => ({
          role: turn.role,
          content: turn.wire ?? turn.content,
        }))
      );

      try {
        // The server only answers signed-in members; it reads who is asking
        // from this token, never from the request body.
        const { data: auth } = await supabase.auth.getSession();
        const response = await sendTurn(
          {
            message: wire,
            ...(conversationId.current
              ? { conversationId: conversationId.current }
              : {}),
            ...(history.length > 0 ? { history } : {}),
            ...(consented.current || hasPortfolioConsent() ? { portfolioConsent: true } : {}),
          },
          undefined,
          undefined,
          auth.session?.access_token ?? null
        );

        conversationId.current = response.conversationId;

        // Keep the turn, flag the ones that had nothing to give, then add the
        // answer.
        transcript.current = [
          ...transcript.current,
          {
            id: nextId("assistant"),
            role: "assistant",
            content: response.answer,
            sources: response.sources,
            links: response.links,
            warnings: response.warnings,
            tools: response.toolCalls.map((call) => call.tool),
            ...(response.needsConsent ? { consent: response.needsConsent } : {}),
          },
        ];
        setMessages(transcript.current);
      } catch (error) {
        const code =
          error instanceof AgentRequestError ? error.code : "INTERNAL_ERROR";
        const message =
          error instanceof AgentRequestError
            ? error.message
            : "Something went wrong while contacting StockSphere AI. Please try again.";

        // Developer-facing detail only; the panel renders `message`.
        console.error("StockSphere AI request failed:", code, error);

        // The failed question stays in the transcript with a marker so the user
        // can see what did not get through and retry it, rather than watching
        // it vanish.
        transcript.current = transcript.current.map((turn) =>
          turn.id === userTurn.id ? { ...turn, failed: true } : turn
        );
        setMessages(transcript.current);
        setFailure({ code, message });
      } finally {
        inFlight.current = false;
        setIsSending(false);
      }
    },
    [symbol, sendTurn]
  );

  const send = useCallback(
    (text: string) => {
      void runTurn(text);
    },
    [runTurn]
  );

  /**
   * Re-send the most recent question that failed. The failed turn is dropped
   * first so the retry does not appear twice in the transcript or in history.
   */
  const retry = useCallback(() => {
    if (inFlight.current) return;

    const last = transcript.current[transcript.current.length - 1];
    if (!last || last.role !== "user" || !last.failed) return;

    transcript.current = transcript.current.slice(0, -1);
    setMessages(transcript.current);
    void runTurn(last.content);
  }, [runTurn]);

  const answerConsent = useCallback(
    (allow: boolean) => {
      if (inFlight.current) return;
      const turns = transcript.current;
      const notice = turns[turns.length - 1];
      const question = turns[turns.length - 2];
      if (!notice?.consent || question?.role !== "user") return;

      if (!allow) {
        transcript.current = [
          ...turns.slice(0, -1),
          { id: nextId("assistant"), role: "assistant", content: "No problem. Nothing was sent. You can still ask about any stock, or open the Portfolio page to see your allocation there." },
        ];
        setMessages(transcript.current);
        return;
      }

      consented.current = true;
      try {
        window.localStorage.setItem(PORTFOLIO_CONSENT_KEY, "yes");
      } catch {
        // Private mode: consent holds for this panel only.
      }
      // Drop the question and the notice, then ask again; the question reappears once.
      transcript.current = turns.slice(0, -2);
      setMessages(transcript.current);
      void runTurn(question.content);
    },
    [runTurn]
  );

  const reset = useCallback(() => {
    if (inFlight.current) return;

    transcript.current = [];
    conversationId.current = undefined;
    setMessages([]);
    setFailure(null);
  }, []);

  return {
    messages,
    isSending,
    failure,
    inputLimit: maxQuestionLength(symbol),
    send,
    retry,
    reset,
    answerConsent,
  };
}
