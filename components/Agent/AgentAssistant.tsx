"use client";

import { useCallback, useState } from "react";

import { useAgentChat } from "@/lib/agent/client/useAgentChat";
import AgentLauncher from "./AgentLauncher";
import AgentPanel from "./AgentPanel";

/**
 * The StockSphere AI feature as the Stock Page sees it: one component, one
 * prop.
 *
 * The conversation state is owned here, above the panel, so closing and
 * reopening the panel keeps the transcript, and so nothing about the agent
 * lives in the stock page's own state.
 */
export default function AgentAssistant({
  symbol,
  companyName,
}: {
  symbol: string;
  companyName?: string;
}) {
  const [open, setOpen] = useState(false);
  const chat = useAgentChat({ symbol });

  const openPanel = useCallback(() => setOpen(true), []);
  const closePanel = useCallback(() => setOpen(false), []);

  return (
    <>
      <AgentLauncher
        symbol={symbol}
        companyName={companyName}
        onOpen={openPanel}
      />

      <AgentPanel
        open={open}
        onClose={closePanel}
        symbol={symbol}
        chat={chat}
      />
    </>
  );
}
