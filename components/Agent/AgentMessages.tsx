"use client";

import { useEffect, useRef } from "react";

import type { ChatFailure, ChatMessage } from "@/lib/agent/client/types";
import AgentMessage from "./AgentMessage";
import AgentSuggestions from "./AgentSuggestions";

function Thinking() {
  return (
    <div className="flex gap-2.5" role="status" aria-live="polite">
      <div
        aria-hidden="true"
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-green-500/30 bg-green-500/10 text-[13px] text-green-400"
      >
        ✦
      </div>

      <div className="flex items-center gap-2.5 rounded-2xl rounded-bl-md border border-[#222] bg-[#141414] px-4 py-3">
        <span className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-green-500/70"
              // Staggered so the three dots read as motion, not as a stalled
              // loading bar. Values are inline because Tailwind has no utility
              // for a per-element animation delay.
              style={{ animationDelay: `${index * 140}ms` }}
            />
          ))}
        </span>

        <span className="text-[12.5px] text-[#999]">
          StockSphere AI is thinking...
        </span>
      </div>
    </div>
  );
}

function FailureNotice({
  failure,
  onRetry,
}: {
  failure: ChatFailure;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-500/25 bg-red-500/[0.07] px-3.5 py-3"
    >
      <p className="text-[12.5px] leading-relaxed text-red-200">
        {failure.message}
      </p>

      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11.5px] font-semibold text-red-300 transition hover:border-red-400/50 hover:bg-red-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
      >
        Try again
      </button>
    </div>
  );
}

export default function AgentMessages({
  messages,
  isSending,
  failure,
  symbol,
  onSelect,
  onRetry,
}: {
  messages: ChatMessage[];
  isSending: boolean;
  failure: ChatFailure | null;
  symbol: string | null;
  onSelect: (question: string) => void;
  onRetry: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn in view as the conversation grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, isSending, failure]);

  const isEmpty = messages.length === 0;

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto overscroll-contain px-3.5 py-4"
    >
      {isEmpty ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#222] bg-[#141414] px-4 py-3.5">
            <p className="text-[13.5px] font-semibold text-white">
              Ask about{" "}
              <span className="text-green-400">{symbol ?? "any stock"}</span>
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-[#888]">
              I can pull live prices, company details, recent news, financials
              and price history straight from StockSphere&apos;s data — then
              explain what they mean. I won&apos;t guess at numbers I
              couldn&apos;t retrieve.
            </p>
          </div>

          <AgentSuggestions
            symbol={symbol}
            onSelect={onSelect}
            disabled={isSending}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {messages.map((message) => (
            <AgentMessage key={message.id} message={message} />
          ))}

          {isSending && <Thinking />}
        </div>
      )}

      {failure && (
        <div className="mt-4">
          <FailureNotice failure={failure} onRetry={onRetry} />
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
