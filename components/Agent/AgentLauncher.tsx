"use client";

/**
 * The Agent's entry point on the Stock Page.
 *
 * Deliberately a single compact card that sits in the page's existing card
 * language — same #111 surface, same 1px #222 border, same rounded corners as
 * the stat tiles around it — with a green wash to mark it as the AI feature.
 * It adds one element to the page and displaces nothing.
 */
export default function AgentLauncher({
  symbol,
  companyName,
  onOpen,
}: {
  symbol: string;
  companyName?: string;
  onOpen: () => void;
}) {
  const subject = companyName ? `${companyName} (${symbol})` : symbol;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Ask StockSphere AI about ${symbol}`}
      className="group mt-[30px] flex w-full items-center gap-4 rounded-[16px] border border-[#222] bg-gradient-to-r from-[#111] via-[#111] to-green-500/[0.07] p-5 text-left transition hover:border-green-500/40 hover:to-green-500/[0.12] focus:outline-none focus-visible:border-green-500/60 focus-visible:ring-2 focus-visible:ring-green-500/30"
    >
      <span
        aria-hidden="true"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-green-500/30 bg-green-500/10 text-[18px] text-green-400 transition group-hover:bg-green-500/15"
      >
        ✦
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-white">
          Ask StockSphere <span className="text-green-500">AI</span>
        </span>

        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-[#888]">
          {/* One bound string, not JSX text around an expression: a JSX text
              node that starts with a space loses it, which rendered this copy
              as "(RELIANCE)— price". */}
          {`Get a grounded read on ${subject} — price, news, financials or a summary. Every figure comes from StockSphere's own data.`}
        </span>
      </span>

      <span className="hidden shrink-0 items-center gap-2 rounded-[10px] bg-green-500 px-4 py-2.5 text-[13px] font-semibold text-black transition group-hover:bg-green-400 sm:flex">
        Ask about {symbol}
        <span aria-hidden="true">→</span>
      </span>
    </button>
  );
}
