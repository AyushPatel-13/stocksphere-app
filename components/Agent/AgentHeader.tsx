"use client";

export default function AgentHeader({
  symbol,
  isSending,
  canReset,
  onReset,
  onClose,
}: {
  symbol: string | null;
  isSending: boolean;
  canReset: boolean;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-[#222] bg-[#0d0d0d] px-4 py-3">
      <div
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-green-500/30 bg-green-500/10 text-[15px] text-green-400"
      >
        ✦
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-[14px] font-bold tracking-tight text-white">
            Stock<span className="text-green-500">Sphere</span> AI
          </h2>

          <span className="flex shrink-0 items-center gap-1.5">
            <span
              aria-hidden="true"
              className={[
                "h-1.5 w-1.5 rounded-full",
                isSending ? "animate-pulse bg-amber-400" : "bg-green-500",
              ].join(" ")}
            />
            <span className="text-[10.5px] font-medium uppercase tracking-wide text-[#777]">
              {isSending ? "Thinking" : "Ready"}
            </span>
          </span>
        </div>

        <p className="truncate text-[11.5px] text-[#888]">
          {symbol ? `Analyzing ${symbol}` : "Your market research assistant"}
        </p>
      </div>

      {canReset && (
        <button
          type="button"
          onClick={onReset}
          disabled={isSending}
          className="shrink-0 rounded-lg px-2 py-1 text-[11.5px] font-medium text-[#888] transition hover:bg-[#1c1c1c] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ↺ New
        </button>
      )}

      <button
        type="button"
        onClick={onClose}
        aria-label="Close StockSphere AI"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#888] transition hover:bg-[#1c1c1c] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </header>
  );
}
