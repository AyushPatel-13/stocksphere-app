"use client";

import { useEffect, useRef, useState } from "react";

import SearchBox from "@/components/Search/SearchBox";

/**
 * The navbar's search: a button (and Ctrl/⌘+K anywhere) that opens the same
 * instrument search in a modal, so it works on every page and on phones.
 * Esc closes the dropdown first, then the modal; clicking the backdrop closes.
 */
export default function SearchModal() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search (Ctrl+K)"
        aria-haspopup="dialog"
        className="flex shrink-0 items-center gap-2 rounded-lg border border-[#222] bg-[#111] px-2.5 py-2 text-sm text-[#999] transition-colors hover:border-[#333] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
      >
        <span aria-hidden="true">⌕</span>
        <span className="hidden xl:inline">Search</span>
        <kbd className="hidden rounded border border-[#2a2a2a] px-1 text-[10px] text-[#666] xl:inline">Ctrl K</kbd>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search instruments"
          className="fixed inset-0 z-[60] flex items-start justify-center bg-black/70 px-4 pt-[12vh] backdrop-blur-sm"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          onKeyDown={(event) => {
            // SearchBox handles the first Esc (closing its dropdown) and
            // marks it handled; an unhandled Esc closes the modal.
            if (event.key === "Escape" && !event.defaultPrevented) close();
          }}
        >
          <div className="w-full max-w-xl">
            <SearchBox variant="compact" autoFocus onNavigate={() => setOpen(false)} />
            <p className="mt-3 text-center text-xs text-[#666]">↑ ↓ to move · Enter to open · Esc to close</p>
          </div>
        </div>
      )}
    </>
  );
}
