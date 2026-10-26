import type { InstrumentType } from "../search/types";

/**
 * The composer's @ handling, as pure functions so every rule is unit-tested:
 * when an @ starts a mention, what it searches for, how a pick is inserted
 * without corrupting the text, and which picks survive later edits.
 * Safe to import from the browser.
 */

export const MENTION_QUERY_MAX = 40;
export const MAX_PICKS = 5;

/** What the member picked, as sent to the server (which verifies it). */
export type MentionPick =
  | { kind: "instrument"; id: string; type: InstrumentType; text: string; name: string; detail: string }
  | { kind: "ipo"; ipoId: string; text: string; name: string; detail: string }
  | { kind: "bond"; isin: string; text: string; name: string; detail: string };

/** A query may hold the characters names and tickers use, and single spaces. */
const QUERY_CHARS = /^[A-Za-z0-9&.'-]*(?: [A-Za-z0-9&.'-]+)*( )?$/;

/**
 * The mention being typed at the caret: where its @ is and the text after it.
 * Null when the caret isn't in one — an @ inside a word or an email address
 * ("me@sbi.com"), across a line break, after a double space, or too long.
 */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  if (caret < 1 || caret > text.length) return null;
  const from = Math.max(0, caret - MENTION_QUERY_MAX - 1);
  const at = text.lastIndexOf("@", caret - 1);
  if (at < from) return null;
  if (at > 0 && /[A-Za-z0-9_.@]/.test(text[at - 1])) return null;
  const query = text.slice(at + 1, caret);
  if (query.length > MENTION_QUERY_MAX || /[\r\n]/.test(query) || query.startsWith(" ") || !QUERY_CHARS.test(query)) return null;
  return { start: at, query };
}

/** The readable text a pick inserts: "@SBIN", "@Tonbo Imaging India IPO", "@718GS2033" (a bond's exchange symbol). */
export function mentionTextFor(pick: { kind: "instrument" | "bond"; symbol: string } | { kind: "ipo"; name: string }): string {
  const raw = pick.kind === "ipo" ? pick.name : pick.symbol;
  return `@${raw.replace(/[\r\n@]+/g, " ").replace(/\s+/g, " ").trim()}`.slice(0, 80);
}

/** Replaces the @query with the mention plus one space, and puts the caret after it. */
export function insertMention(text: string, start: number, caret: number, mention: string): { text: string; caret: number } {
  const after = text.slice(caret);
  const spacer = after.startsWith(" ") ? "" : " ";
  const next = `${text.slice(0, start)}${mention}${spacer}${after}`;
  return { text: next, caret: start + mention.length + 1 };
}

/** Where each pick's text sits, in order of appearance — or null for a pick whose text was edited away. */
function spansOf(text: string, picks: MentionPick[]): ({ pick: MentionPick; start: number; end: number } | null)[] {
  const taken: [number, number][] = [];
  return picks.map((pick) => {
    let index = text.indexOf(pick.text);
    while (index !== -1) {
      const end = index + pick.text.length;
      const boundary = index === 0 || !/[A-Za-z0-9_.@]/.test(text[index - 1]);
      const free = !taken.some(([s, e]) => index < e && end > s);
      if (boundary && free) {
        taken.push([index, end]);
        return { pick, start: index, end };
      }
      index = text.indexOf(pick.text, index + 1);
    }
    return null;
  });
}

/**
 * The picks still present in the text, in the order they appear (the order
 * the server locates them in). A pick whose text was changed is dropped, so
 * a post never claims a mention its text no longer shows.
 */
export function livePicks(text: string, picks: MentionPick[]): MentionPick[] {
  return spansOf(text, picks)
    .filter((span): span is { pick: MentionPick; start: number; end: number } => span !== null)
    .sort((a, b) => a.start - b.start)
    .map((span) => span.pick);
}

/** Removes a pick and its text (and one following space). */
export function removePick(text: string, picks: MentionPick[], index: number): { text: string; picks: MentionPick[] } {
  const spans = spansOf(text, picks);
  const span = spans[index];
  const rest = picks.filter((_, i) => i !== index);
  if (!span) return { text, picks: rest };
  const end = text[span.end] === " " ? span.end + 1 : span.end;
  return { text: text.slice(0, span.start) + text.slice(end), picks: rest };
}

/** The request body's `mentions`. */
export function toMentionInputs(picks: MentionPick[]) {
  return picks.map((pick) =>
    pick.kind === "instrument"
      ? { kind: "instrument", id: pick.id, type: pick.type, text: pick.text }
      : pick.kind === "bond"
        ? { kind: "bond", isin: pick.isin, text: pick.text }
        : { kind: "ipo", ipoId: pick.ipoId, text: pick.text }
  );
}

/** A stable key for a pick (React lists, de-duplication). */
export function pickKey(pick: MentionPick): string {
  return pick.kind === "instrument" ? `instrument:${pick.id}` : pick.kind === "bond" ? `bond:${pick.isin}` : `ipo:${pick.ipoId}`;
}
