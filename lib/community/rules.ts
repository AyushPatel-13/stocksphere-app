import { isValidSymbol } from "../validation/symbol";

/**
 * Community posting rules. Pure functions, so every rule is unit-tested and
 * the server (lib/community/service.ts) is the only place they are enforced.
 *
 * The goal is the one agreed for StockSphere: real people sharing views, no
 * tip-selling, group-promotion or pump spam.
 */

export const POST_MAX_LENGTH = 1000;
export const MAX_SYMBOLS = 5;

export type Sentiment = "bullish" | "bearish";

/* ------------------------------------------------------------ titles and types */

export const TITLE_MAX_LENGTH = 120;

/** What sort of post it is. Optional; comments never have one. */
export const POST_KINDS = ["analysis", "technical", "earnings", "news", "question", "discussion"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const POST_KIND_LABELS: Record<PostKind, string> = {
  analysis: "Analysis",
  technical: "Technical Analysis",
  earnings: "Earnings",
  news: "News",
  question: "Question",
  discussion: "Discussion",
};

export function isPostKind(value: unknown): value is PostKind {
  return typeof value === "string" && (POST_KINDS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------ cashtags */

/**
 * $CASHTAGS in a post, uppercase and de-duplicated, in order of appearance.
 * "$TCS", "$tcs", "$M&M" and "$BAJAJ-AUTO" all count; "$100" does not (it is
 * a price, so a cashtag must start with a letter).
 */
export function extractCashtags(body: string): string[] {
  const found: string[] = [];

  for (const match of body.matchAll(/\$([A-Za-z][A-Za-z0-9&.-]{0,19})/g)) {
    const symbol = match[1].replace(/[.-]+$/, "").toUpperCase();
    if (isValidSymbol(symbol) && !found.includes(symbol)) found.push(symbol);
  }

  return found;
}

/** The board symbol first, then cashtags, capped at MAX_SYMBOLS. */
export function postSymbols(body: string, boardSymbol?: string | null): string[] {
  const board = boardSymbol ? boardSymbol.trim().toUpperCase() : "";
  const all = [...(board && isValidSymbol(board) ? [board] : []), ...extractCashtags(body)];
  return Array.from(new Set(all)).slice(0, MAX_SYMBOLS);
}

/* ------------------------------------------------------------ content */

export type ContentVerdict = { ok: true; body: string } | { ok: false; reason: string };

const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi;

/** Phrases that mark tip-selling, group promotion or pump-and-dump spam. */
const BLOCKED_PATTERNS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\b(t\.me|telegram\.me|telegram\.dog|chat\.whatsapp\.com|wa\.me|whatsapp\.com\/channel)\b/i,
    reason: "Links to Telegram or WhatsApp groups aren't allowed.",
  },
  {
    pattern: /\b(join|subscribe to|dm me for|message me for|contact (me|us) for)\b.{0,30}\b(telegram|whatsapp|channel|group|tips|calls|premium)\b/i,
    reason: "Promoting groups, channels or paid tips isn't allowed.",
  },
  {
    pattern: /\b(sure[\s-]?shot|jackpot (call|stock)|guaranteed (returns?|profits?|gains?)|100\s?% (profit|returns?|sure)|operator (call|stock|news)|multibagger guaranteed)\b/i,
    reason: "Guaranteed-profit or \"sure-shot\" tips aren't allowed. Share your view and your reasoning instead.",
  },
  {
    pattern: /\b(paid (tips|calls|group)|premium (tips|calls|group)|tips? for (a )?fee|registration fee)\b/i,
    reason: "Selling tips or paid groups isn't allowed.",
  },
];

// Indian mobile numbers (with or without +91 / 0 and separators).
const PHONE_PATTERN = /(?:\+?91[\s-]?|\b0)?\b[6-9]\d{4}[\s-]?\d{5}\b/;

/**
 * Check a post body. `canPostLinks` is false for new accounts: links are the
 * main vehicle for spam, so they unlock once an account has some history.
 */
export function checkContent(raw: string, canPostLinks: boolean): ContentVerdict {
  const body = raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  if (!body) return { ok: false, reason: "Write something first." };
  if (body.length > POST_MAX_LENGTH) {
    return { ok: false, reason: `Keep it under ${POST_MAX_LENGTH} characters.` };
  }

  const blocked = blockedReason(body);
  if (blocked) return { ok: false, reason: blocked };

  const links = body.match(URL_PATTERN) ?? [];
  if (links.length > 0 && !canPostLinks) {
    return { ok: false, reason: "New accounts can't post links yet. This unlocks after a few days." };
  }
  if (links.length > 2) {
    return { ok: false, reason: "Use at most 2 links in a post." };
  }

  if (shouting(body)) return { ok: false, reason: "Please don't post in all caps." };

  // A run of the same character ("🚀🚀🚀🚀🚀🚀🚀🚀", "!!!!!!!!!!") is noise.
  if (/(.)\1{9,}/u.test(body)) {
    return { ok: false, reason: "Too many repeated characters." };
  }

  return { ok: true, body };
}

/** Spam, tip-selling and phone numbers: refused in a title as in a body. */
function blockedReason(text: string): string | null {
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(text)) return reason;
  }
  return PHONE_PATTERN.test(text) ? "Phone numbers aren't allowed in posts." : null;
}

/** Shouting: mostly capital letters in a longer text. */
function shouting(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  const capitals = text.replace(/[^A-Z]/g, "");
  return letters.length >= 20 && capitals.length / letters.length > 0.7;
}

export type TitleVerdict = { ok: true; title: string | null } | { ok: false; reason: string };

/**
 * Check an optional title: one line, at most TITLE_MAX_LENGTH characters,
 * no links, and the same spam rules as a body. Blank means no title.
 */
export function checkTitle(raw: unknown): TitleVerdict {
  if (raw === undefined || raw === null) return { ok: true, title: null };
  if (typeof raw !== "string") return { ok: false, reason: "Invalid title." };

  const title = raw.replace(/\s+/g, " ").trim();
  if (!title) return { ok: true, title: null };
  if (title.length > TITLE_MAX_LENGTH) return { ok: false, reason: `Keep the title under ${TITLE_MAX_LENGTH} characters.` };
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(title)) return { ok: false, reason: "Put links in the post, not the title." };

  const blocked = blockedReason(title);
  if (blocked) return { ok: false, reason: blocked };
  if (shouting(title)) return { ok: false, reason: "Please don't write the title in all caps." };
  return { ok: true, title };
}

/* ------------------------------------------------------------ limits */

export const NEW_ACCOUNT_DAYS = 3;
export const LINK_UNLOCK_DAYS = 7;

export type RateCounts = {
  /** Posts (including replies) by this author in the last 10 minutes. */
  last10Minutes: number;
  /** …and in the last 24 hours. */
  last24Hours: number;
};

export function accountAgeDays(createdAt: string, now: number): number {
  return (now - Date.parse(createdAt)) / 86_400_000;
}

/**
 * Whether one more post is allowed. New accounts get tighter limits — the
 * cheapest defence against throwaway spam accounts.
 */
export function checkRate(counts: RateCounts, ageDays: number): { ok: true } | { ok: false; reason: string } {
  const isNew = ageDays < NEW_ACCOUNT_DAYS;
  const per10 = isNew ? 3 : 8;
  const perDay = isNew ? 15 : 60;

  if (counts.last10Minutes >= per10) {
    return { ok: false, reason: "You're posting too fast. Please wait a few minutes." };
  }
  if (counts.last24Hours >= perDay) {
    return {
      ok: false,
      reason: isNew
        ? "New accounts can post up to 15 times a day. Your limit resets tomorrow."
        : "You've reached today's posting limit.",
    };
  }
  return { ok: true };
}

/** Same text from the same author recently: almost always spam or a double-tap. */
export function normaliseForDuplicate(body: string): string {
  return body.toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} $]/gu, "").trim();
}
