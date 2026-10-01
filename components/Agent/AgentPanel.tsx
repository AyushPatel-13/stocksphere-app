"use client";

import { useEffect } from "react";

import type { UseAgentChat } from "@/lib/agent/client/useAgentChat";
import AgentHeader from "./AgentHeader";
import AgentInput from "./AgentInput";
import AgentMessages from "./AgentMessages";

/**
 * The conversation panel.
 *
 * Rendered as a right-hand sheet rather than a modal: the stock page stays
 * visible and usable beside it, which is the point — the user is asking about
 * what is on the page. It is always mounted and slid out of view when closed,
 * so the transcript survives a close/reopen and the slide animates in both
 * directions. While closed it is `inert`, which keeps it out of the tab order
 * and the accessibility tree without a focus trap, so keyboard users are never
 * stranded inside a panel they cannot see.
 */
export default function AgentPanel({
  open,
  onClose,
  symbol,
  chat,
}: {
  open: boolean;
  onClose: () => void;
  symbol: string | null;
  chat: UseAgentChat;
}) {
  const { messages, isSending, failure, inputLimit, send, retry, reset } = chat;

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Move focus to the composer on open so the keyboard is ready, without
  // locking focus there.
  useEffect(() => {
    if (!open) return;

    const id = window.setTimeout(() => {
      document.getElementById("agent-input")?.focus();
    }, 50);

    return () => window.clearTimeout(id);
  }, [open]);

  return (
    <aside
      aria-label="StockSphere AI assistant"
      aria-hidden={!open}
      inert={!open}
      className={[
        "fixed inset-y-0 right-0 z-[100] flex w-full flex-col",
        "border-l border-[#222] bg-[#0a0a0a] shadow-2xl md:w-[440px]",
        "transition-transform duration-300 ease-out will-change-transform",
        open ? "translate-x-0" : "translate-x-full",
      ].join(" ")}
    >
      <AgentHeader
        symbol={symbol}
        isSending={isSending}
        canReset={messages.length > 0}
        onReset={reset}
        onClose={onClose}
      />

      <AgentMessages
        messages={messages}
        isSending={isSending}
        failure={failure}
        symbol={symbol}
        onSelect={send}
        onRetry={retry}
      />

      <AgentInput
        symbol={symbol}
        onSend={send}
        // The busy state is carried by the send button, not by disabling the
        // composer. A disabled textarea drops focus to <body> the moment a
        // question is sent — a keyboard user had to Tab back in after every
        // answer. The composer stays focusable and typeable while the Agent
        // works; AgentInput.submit() already refuses to send while `busy`, so a
        // second question typed now is kept until the first answer lands.
        busy={isSending}
        maxLength={inputLimit}
      />
    </aside>
  );
}
