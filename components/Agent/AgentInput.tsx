"use client";

import { useEffect, useRef, useState } from "react";

const MAX_TEXTAREA_HEIGHT = 140;

export default function AgentInput({
  symbol,
  onSend,
  busy,
  maxLength,
}: {
  symbol: string | null;
  onSend: (text: string) => void;
  /**
   * Whether a turn is in flight. The composer itself is never disabled — see
   * the note at the call site in AgentPanel.tsx — so this only stops a second
   * send, leaving what the user types next in the box.
   */
  busy?: boolean;
  maxLength: number;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the message up to a ceiling, then scroll inside the box — so a
  // long question never pushes the conversation off screen.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [value]);

  const submit = () => {
    const question = value.trim();
    if (!question || busy) return;

    onSend(question);
    setValue("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;

    // Mid-composition Enter belongs to the IME, not to us.
    if (event.nativeEvent.isComposing) return;

    event.preventDefault();
    submit();
  };

  const placeholder = symbol
    ? `Ask about ${symbol}...`
    : "Ask StockSphere AI anything...";

  const remaining = maxLength - value.length;

  return (
    <div className="border-t border-[#222] bg-[#0d0d0d] px-3 pb-3 pt-2.5">
      <div className="flex items-end gap-2 rounded-2xl border border-[#2a2a2a] bg-[#171717] px-3 py-2 transition focus-within:border-green-500/50 focus-within:ring-2 focus-within:ring-green-500/20">
        <label htmlFor="agent-input" className="sr-only">
          {placeholder}
        </label>

        <textarea
          id="agent-input"
          ref={textareaRef}
          rows={1}
          value={value}
          maxLength={maxLength}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="max-h-[140px] min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[13.5px] leading-relaxed text-white placeholder:text-[#666] focus:outline-none"
        />

        <button
          type="button"
          onClick={submit}
          disabled={busy || value.trim().length === 0}
          aria-label="Send message"
          className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-green-500 text-black transition hover:bg-green-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50 disabled:cursor-not-allowed disabled:bg-[#2a2a2a] disabled:text-[#666]"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </button>
      </div>

      <div className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-[#5a5a5a]">
        <span>
          Enter to send · Shift + Enter for a new line
        </span>

        {remaining <= 100 && (
          <span className={remaining <= 0 ? "text-red-400" : undefined}>
            {value.length}/{maxLength}
          </span>
        )}
      </div>
    </div>
  );
}
