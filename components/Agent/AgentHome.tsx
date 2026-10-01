"use client";

import { useCallback, useState } from "react";

import { useAgentChat } from "@/lib/agent/client/useAgentChat";
import AgentPanel from "./AgentPanel";

/**
 * The StockSphere AI feature as the Home page sees it.
 *
 * This is a second *entry point* to the same agent, not a second agent. It
 * renders the same AgentPanel — and therefore the same AgentHeader,
 * AgentMessages, AgentInput, AgentSuggestions and AgentMessage — over the same
 * useAgentChat hook, the same POST /api/agent contract, the same orchestrator
 * and the same tools. Nothing about the conversation is re-implemented here;
 * the only thing this file owns is where the conversation is opened from.
 *
 * The Stock Page's AgentAssistant stays exactly as it was: its launcher is
 * deliberately stock-scoped — it requires a symbol, and its copy names it
 * ("Ask about TCS"). Home has no selected stock, so it gets its own launcher
 * rather than an AgentLauncher given a symbol it does not have.
 *
 * The missing symbol is not a gap to paper over. The panel and the hook were
 * already written to take `string | null`, and a null symbol is a supported,
 * neutral mode rather than a degraded one:
 *
 *   - useAgentChat({ symbol: null }) → composeMessage() adds no context line,
 *     so the agent is asked the user's question and nothing else. No stock is
 *     invented, and no symbol is guessed at.
 *   - AgentHeader reads "Your market research assistant".
 *   - AgentMessages opens with "Ask about any stock".
 *   - AgentSuggestions offers symbol-free prompts ("What can you help me with?").
 *   - AgentInput asks "Ask StockSphere AI anything...".
 *
 * So the agent resolves a symbol itself, through resolve_symbol, exactly as it
 * does from the Stock Page — or asks for one. Every figure it reports still
 * comes from a tool it actually called.
 */
export default function AgentHome() {
  const [open, setOpen] = useState(false);
  const chat = useAgentChat({ symbol: null });

  const openPanel = useCallback(() => setOpen(true), []);
  const closePanel = useCallback(() => setOpen(false), []);

  return (
    <>
      {/* The entry point: an assistant pill, not a card.
          The earlier card — 266x66, #111 surface, 16px radius, two lines of
          copy — read as one more dashboard section: the same shape and the same
          weight as Recently Viewed and the market cards under it, which is
          exactly what a way *into* the assistant should not look like. So the
          design language is the pill instead: fully rounded, 50px tall, one
          line, no description, no CTA block. Nothing else on the page is a
          pill, so it reads as its own thing — a shortcut that is always there,
          sitting under the navbar beside Login.

          It stays in normal flow. The row is right-aligned inside a container
          that reproduces the navbar's own box (max-w-[1600px], the same
          px-4/sm:px-5), so the pill's right edge lands on the Login button's
          right edge at every width without any absolute positioning. The
          vertical placement and the space it leaves below live in the wrapper
          in app/page.tsx, because that is page layout rather than the pill.

          On mobile it is a full-width button: same pill, same one line, no
          floating offset, exactly the width the navbar's padding allows.

          The whole pill is the button, which is what makes it reachable by
          keyboard and openable with Enter or Space without a key handler. */}
      <div className="flex sm:justify-end">
        <button
          type="button"
          onClick={openPanel}
          aria-label="Open StockSphere AI assistant"
          className="group flex h-[52px] w-full items-center justify-between gap-2 rounded-full border border-[#222] bg-[#111] px-3 text-left transition duration-200 hover:border-green-500/40 hover:bg-[#121712] hover:shadow-[0_0_20px_-6px_rgba(34,197,94,0.45)] focus:outline-none focus-visible:border-green-500/60 focus-visible:ring-2 focus-visible:ring-green-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:h-[50px] sm:w-[212px] sm:px-2.5"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-green-500/25 bg-green-500/10 text-[14px] leading-none text-green-400 transition duration-200 group-hover:border-green-500/45 group-hover:bg-green-500/15"
            >
              ✦
            </span>

            <span className="truncate text-[13.5px] font-semibold text-white">
              StockSphere <span className="text-green-500">AI</span>
            </span>
          </span>

          {/* The only motion in the pill: the arrow leans a few pixels toward
              where the panel will open, and takes on the green. */}
          <span
            aria-hidden="true"
            className="shrink-0 pr-1 text-[13px] leading-none text-[#666] transition duration-200 group-hover:translate-x-[3px] group-hover:text-green-400"
          >
            →
          </span>
        </button>
      </div>

      <AgentPanel
        open={open}
        onClose={closePanel}
        symbol={null}
        chat={chat}
      />
    </>
  );
}
