"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type TextareaHTMLAttributes } from "react";

import { bondFacts } from "@/lib/bonds/bonds";
import { fetchEntities } from "@/lib/community/client";
import type { EntitySuggestion } from "@/lib/community/entities";
import { MAX_PICKS, activeMention, insertMention, livePicks, mentionTextFor, type MentionPick } from "@/lib/community/mentionInput";
import { nextActiveIndex } from "@/lib/search/types";

/**
 * A textarea with an @ autocomplete for stocks, IPOs and bonds, anchored at
 * the caret. Typing "@sbi" lists verified matches from /api/community/entities;
 * picking one inserts "@SBIN " and records the pick (its id), which the server
 * verifies again when the post is saved. Arrow keys, Enter/Tab, Escape, mouse
 * and touch all work; an @ inside a word or email address doesn't open it.
 */

type Lookup =
  | { status: "idle" }
  | { status: "hint" }
  | { status: "loading"; query: string }
  | { status: "ready"; query: string; results: EntitySuggestion[]; partial: boolean }
  | { status: "error"; query: string; message: string };

const DEBOUNCE_MS = 180;
const POPOVER_WIDTH = 320;

/** Pixel position of a caret inside a textarea, via a mirror element with the same styles. */
function caretPoint(textarea: HTMLTextAreaElement, position: number): { top: number; left: number; height: number } {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const props = [
    "boxSizing", "width", "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderLeftWidth", "textTransform", "wordSpacing", "tabSize",
  ] as const;
  for (const prop of props) mirror.style[prop] = style[prop];
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.textContent = textarea.value.slice(0, position);
  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(position) || ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const point = { top: marker.offsetTop - textarea.scrollTop, left: marker.offsetLeft - textarea.scrollLeft, height: parseFloat(style.lineHeight) || 22 };
  document.body.removeChild(mirror);
  return point;
}

function pickFrom(suggestion: EntitySuggestion): MentionPick {
  const text = mentionTextFor(suggestion);
  if (suggestion.kind === "instrument") {
    return { kind: "instrument", id: suggestion.id, type: suggestion.type, text, name: suggestion.name, detail: `${suggestion.symbol} · ${suggestion.exchange}` };
  }
  if (suggestion.kind === "bond") return { kind: "bond", isin: suggestion.isin, text, name: suggestion.name, detail: bondFacts(suggestion) };
  return { kind: "ipo", ipoId: suggestion.ipoId, text, name: suggestion.name, detail: `IPO · ${suggestion.status === "open" ? "Open" : "Upcoming"}` };
}

function keyOf(suggestion: EntitySuggestion): string {
  return suggestion.kind === "instrument" ? suggestion.id : suggestion.kind === "bond" ? `bond:${suggestion.isin}` : `ipo:${suggestion.ipoId}`;
}

function badgeOf(suggestion: EntitySuggestion): { text: string; className: string } {
  if (suggestion.kind === "ipo") return { text: "IPO", className: "bg-[#f59e0b]/15 text-[#fbbf24]" };
  if (suggestion.kind === "bond") return { text: "BND", className: "bg-[#38bdf8]/12 text-[#7dd3fc]" };
  const text = suggestion.type === "index" ? "IX" : suggestion.type === "crypto" ? "₿" : suggestion.type === "etf" ? "ETF" : "EQ";
  return { text, className: "bg-[#22c55e]/12 text-[#4ade80]" };
}

function detailOf(suggestion: EntitySuggestion): string {
  if (suggestion.kind === "ipo") return `${suggestion.status === "open" ? "IPO open" : "Upcoming IPO"} · ${suggestion.board === "sme" ? "SME" : "Mainboard"}`;
  if (suggestion.kind === "bond") return `${suggestion.symbol} · ${suggestion.exchange} · ${bondFacts(suggestion)}`;
  return `${suggestion.symbol} · ${suggestion.exchange} · ${suggestion.label}`;
}

export type MentionFieldHandle = { focus: () => void; startMention: () => void };

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  picks: MentionPick[];
  onPicksChange: (picks: MentionPick[]) => void;
};

const MentionField = forwardRef<MentionFieldHandle, Props>(function MentionField(
  { value, onChange, picks, onPicksChange, onKeyDown, className, ...rest },
  ref
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  const [active, setActive] = useState(-1);
  const [anchor, setAnchor] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const pendingCaret = useRef<number | null>(null);
  const listId = useId();

  const atLimit = livePicks(value, picks).length >= MAX_PICKS;
  const open = mention !== null && lookup.status !== "idle";
  const results = lookup.status === "ready" ? lookup.results : [];

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    // The "Tag" button: type an @ at the caret and open the list.
    startMention: () => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const caret = textarea.selectionStart ?? value.length;
      const before = value.slice(0, caret);
      const insert = before && !/\s$/.test(before) ? " @" : "@";
      onChange(before + insert + value.slice(caret));
      pendingCaret.current = caret + insert.length;
    },
  }));

  // Put the caret where an insertion left it, then re-read the mention there.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (pendingCaret.current === null || !textarea) return;
    const caret = pendingCaret.current;
    pendingCaret.current = null;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    sync(textarea);
  }, [value]);

  // Search as the member types, debounced; stale answers are dropped.
  const query = mention?.query ?? null;
  useEffect(() => {
    if (query === null) return;
    if (!query.trim()) {
      setLookup({ status: "hint" });
      return;
    }
    const controller = new AbortController();
    setLookup({ status: "loading", query });
    const timer = setTimeout(() => {
      fetchEntities(query.trim(), controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setLookup("error" in result ? { status: "error", query, message: result.error } : { status: "ready", query, ...result });
          setActive("error" in result || result.results.length === 0 ? -1 : 0);
        })
        .catch(() => undefined);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function sync(textarea: HTMLTextAreaElement) {
    const caret = textarea.selectionStart ?? 0;
    const found = textarea.selectionStart === textarea.selectionEnd ? activeMention(textarea.value, caret) : null;
    setMention((current) => (current?.start === found?.start && current?.query === found?.query ? current : found));
    if (!found) {
      setLookup({ status: "idle" });
      return;
    }
    const point = caretPoint(textarea, found.start);
    const width = wrapperRef.current?.clientWidth ?? POPOVER_WIDTH;
    const popover = Math.min(POPOVER_WIDTH, width);
    setAnchor({ top: textarea.offsetTop + point.top + point.height + 4, left: Math.max(0, Math.min(textarea.offsetLeft + point.left, width - popover)) });
  }

  function close() {
    setMention(null);
    setLookup({ status: "idle" });
    setActive(-1);
  }

  function choose(suggestion: EntitySuggestion) {
    const textarea = textareaRef.current;
    if (!mention || !textarea || atLimit) return;
    const pick = pickFrom(suggestion);
    const caret = textarea.selectionStart ?? mention.start + mention.query.length + 1;
    const next = insertMention(value, mention.start, caret, pick.text);
    onPicksChange(livePicks(next.text, [...picks, pick]));
    onChange(next.text);
    pendingCaret.current = next.caret;
    close();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      const moved = nextActiveIndex(event.key, active, results.length);
      if (moved !== undefined && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        setActive(moved);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.metaKey && !event.ctrlKey && active >= 0 && results[active]) {
        event.preventDefault();
        choose(results[active]);
        return;
      }
    }
    onKeyDown?.(event);
  }

  return (
    <div ref={wrapperRef} className="relative min-w-0 flex-1">
      <textarea
        {...rest}
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          // A pick whose text was edited away is no longer a mention.
          const kept = livePicks(event.target.value, picks);
          if (kept.length !== picks.length) onPicksChange(kept);
          sync(event.target);
        }}
        onSelect={(event) => sync(event.currentTarget)}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(close, 120)}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        className={className}
      />

      {open && (
        <div
          className="absolute z-30 overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#151515] text-sm shadow-2xl"
          style={{ top: anchor.top, left: anchor.left, width: `min(${POPOVER_WIDTH}px, 100%)` }}
        >
          {atLimit ? (
            <p className="px-3 py-2.5 text-[#999]">You can mention up to {MAX_PICKS} stocks, IPOs or bonds in a post.</p>
          ) : lookup.status === "hint" ? (
            <p className="px-3 py-2.5 text-[#999]">Type a company, ticker, IPO, or a bond (“GOI 2033”, “REC bond”, an ISIN)</p>
          ) : lookup.status === "loading" ? (
            <p className="px-3 py-2.5 text-[#999]" role="status">Searching…</p>
          ) : lookup.status === "error" ? (
            <p className="px-3 py-2.5 text-[#f87171]" role="alert">{lookup.message}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2.5 text-[#999]" role="status">
              No stock, IPO or listed bond matches “{lookup.status === "ready" ? lookup.query : ""}”{lookup.status === "ready" && lookup.partial ? " (some sources didn't answer)" : ""}.
            </p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Stocks, IPOs and bonds" className="max-h-64 overflow-y-auto overscroll-contain py-1">
              {results.map((suggestion, index) => (
                <li
                  key={keyOf(suggestion)}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  // Pointer-down keeps the textarea focused (mouse and touch).
                  onPointerDown={(event) => {
                    event.preventDefault();
                    choose(suggestion);
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 ${index === active ? "bg-[#1f1f1f]" : ""}`}
                >
                  <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${badgeOf(suggestion).className}`}>
                    {badgeOf(suggestion).text}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-white">{suggestion.name}</span>
                    <span className="block truncate text-[11px] text-[#888]">{detailOf(suggestion)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
});

export default MentionField;
