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

  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(body)) return { ok: false, reason };
  }

  if (PHONE_PATTERN.test(body)) {
    return { ok: false, reason: "Phone numbers aren't allowed in posts." };
  }

  const links = body.match(URL_PATTERN) ?? [];
  if (links.length > 0 && !canPostLinks) {
    return { ok: false, reason: "New accounts can't post links yet. This unlocks after a few days." };
  }
  if (links.length > 2) {
    return { ok: false, reason: "Use at most 2 links in a post." };
  }

  // Shouting: mostly capital letters in a longer post.
  const letters = body.replace(/[^A-Za-z]/g, "");
  const capitals = body.replace(/[^A-Z]/g, "");
  if (letters.length >= 20 && capitals.length / letters.length > 0.7) {
    return { ok: false, reason: "Please don't post in all caps." };
  }

  // A run of the same character ("🚀🚀🚀🚀🚀🚀🚀🚀", "!!!!!!!!!!") is noise.
  if (/(.)\1{9,}/u.test(body)) {
    return { ok: false, reason: "Too many repeated characters." };
  }

  return { ok: true, body };
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
