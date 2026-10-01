"use client";

/**
 * Starting points for an empty conversation.
 *
 * These are prompts only — no prices, no figures, no company facts. Anything
 * resembling an answer would be a hardcoded number the agent never retrieved,
 * which is exactly what the panel exists to avoid; the answers come from the
 * agent, or the panel says they are unavailable.
 */
function suggestionsFor(symbol: string | null): string[] {
  if (!symbol) {
    return [
      "What can you help me with?",
      "What data can you look up?",
    ];
  }

  return [
    `What does ${symbol} do?`,
    `What's the current price of ${symbol}?`,
    `${symbol} recent news`,
    `Summarize the latest results for ${symbol}`,
    `What are the key financials for ${symbol}?`,
    `How has ${symbol} performed recently?`,
  ];
}

export default function AgentSuggestions({
  symbol,
  onSelect,
  disabled,
}: {
  symbol: string | null;
  onSelect: (question: string) => void;
  disabled?: boolean;
}) {
  const suggestions = suggestionsFor(symbol);

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[#666]">
        {symbol ? `About ${symbol}` : "Try asking"}
      </p>

      <div className="space-y-1.5">
        {suggestions.map((question) => (
          <button
            key={question}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(question)}
            className="group flex w-full items-center justify-between gap-3 rounded-xl border border-[#222] bg-[#141414] px-3.5 py-2.5 text-left text-[13px] text-gray-300 transition hover:border-green-500/40 hover:bg-green-500/[0.07] hover:text-white focus:outline-none focus-visible:border-green-500/60 focus-visible:ring-2 focus-visible:ring-green-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="min-w-0 truncate">{question}</span>
            <span
              aria-hidden="true"
              className="shrink-0 text-[#555] transition group-hover:translate-x-0.5 group-hover:text-green-400"
            >
              →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
