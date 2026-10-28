"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * A modal over the page: labelled, focus moves in when it opens and back to
 * what opened it when it closes, Tab stays inside, and the page behind
 * doesn't scroll. `onClose` runs on Escape or a click outside unless
 * `guarded` (a form that asks before discarding handles those itself).
 */
export default function Dialog({
  title,
  onClose,
  guarded = false,
  children,
}: {
  title: string;
  onClose: () => void;
  guarded?: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus the first field (or the panel), unless something inside asked for autofocus already.
    if (!panel.current?.contains(document.activeElement)) {
      const first = panel.current?.querySelector<HTMLElement>("input, textarea, select, button:not([data-dialog-close])");
      (first ?? panel.current)?.focus();
    }
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:px-4"
      onMouseDown={(event) => {
        if (!guarded && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !guarded) {
            event.stopPropagation();
            onClose();
          }
          if (event.key !== "Tab" || !panel.current) return;
          const items = [...panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex='-1'])")];
          if (!items.length) return;
          const first = items[0];
          const last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-[#262626] bg-[#0d0d0d] p-4 shadow-2xl outline-none sm:rounded-2xl sm:p-5"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          {!guarded && (
            <button
              type="button"
              data-dialog-close
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg px-2 py-1 text-[#888] hover:bg-[#1a1a1a] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#22c55e]"
            >
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
