"use client";

import type { ChatMessage } from "@/lib/agent/client/types";
import AgentMarkdown from "./AgentMarkdown";

/**
 * A single turn, styled so the two speakers are distinguishable at a glance
 * without either one dominating the panel: the user's turn is a compact
 * right-aligned bubble, the agent's is a wider left-aligned card with room for
 * formatted financial content.
 */
export default function AgentMessage({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className={[
            "max-w-[85%] rounded-2xl rounded-br-md border px-3.5 py-2.5 text-[13.5px] leading-relaxed",
            message.failed
              ? "border-red-500/30 bg-red-500/10 text-red-200"
              : "border-green-500/25 bg-green-500/10 text-white",
          ].join(" ")}
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    );
  }

  const sources = message.sources ?? [];
  const warnings = message.warnings ?? [];
  const tools = [...new Set(message.tools ?? [])];

  return (
    <div className="flex gap-2.5">
      <div
        aria-hidden="true"
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-green-500/30 bg-green-500/10 text-[13px]"
      >
        ✦
      </div>

      <div className="min-w-0 max-w-[calc(100%-2.5rem)] flex-1">
        {/* break-words so a long unbroken token — a URL in a source line, a
            long symbol — wraps inside the card instead of widening it. */}
        <div className="break-words rounded-2xl rounded-bl-md border border-[#222] bg-[#141414] px-4 py-3">
          <AgentMarkdown content={message.content} />

          {(sources.length > 0 || tools.length > 0) && (
            <div className="mt-3 space-y-2 border-t border-[#222] pt-2.5">
              {/* Same tool names, in the same order, one chip each. They used to
                  be one string joined by two spaces — which HTML collapses to
                  one, so several tools ran together — at 11px #666, the dimmest
                  text in the panel. */}
              {tools.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10.5px] font-medium uppercase tracking-wide text-[#777]">
                    Tools
                  </span>

                  {tools.map((tool) => (
                    <span
                      key={tool}
                      className="rounded-md border border-[#262626] bg-[#1a1a1a] px-1.5 py-0.5 font-mono text-[10.5px] text-[#a3a3a3]"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              )}

              {sources.length > 0 && (
                <p className="break-words text-[11px] leading-relaxed text-[#888]">
                  <span className="text-[#666]">Sources: </span>
                  {sources.join(" · ")}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Warnings are the agent's own report that some data was unavailable —
            surfaced rather than hidden, because an answer built on partial data
            should say so. */}
        {warnings.length > 0 && (
          <ul className="mt-2 space-y-1 pl-1 text-[11.5px] leading-snug text-amber-400/70">
            {warnings.slice(0, 3).map((warning, index) => (
              <li key={index}>⚠ {warning}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
