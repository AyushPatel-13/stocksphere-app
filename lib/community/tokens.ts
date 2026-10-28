/**
 * Split a post body into plain text, $CASHTAG, @mention and link tokens so the
 * UI can render links as React elements. No HTML is ever produced from a post.
 */

export type Token =
  | { type: "text"; value: string }
  | { type: "cashtag"; value: string; symbol: string }
  | { type: "mention"; value: string; handle: string }
  | { type: "link"; value: string; href: string };

const TOKEN_PATTERN =
  /(\$[A-Za-z][A-Za-z0-9&.-]{0,19})|(@[a-z][a-z0-9_]{2,19})\b|((?:https?:\/\/)[^\s<>"']+)/gi;

/** A link shown as a card under a post: where it goes, from the URL alone (nothing is fetched). */
export type LinkPreview = { href: string; host: string; path: string };

/**
 * The post's distinct http(s) links as preview cards, at most `max`. The host
 * comes from the parsed URL (punycode for look-alike domains), so the card
 * shows where a link really goes, whatever its text says.
 */
export function linkPreviews(body: string, max = 2): LinkPreview[] {
  const seen = new Set<string>();
  const previews: LinkPreview[] = [];
  for (const token of tokenize(body)) {
    if (token.type !== "link" || seen.has(token.href)) continue;
    seen.add(token.href);
    const url = new URL(token.href);
    const rest = `${url.pathname === "/" ? "" : url.pathname}${url.search}`;
    previews.push({
      href: token.href,
      host: url.hostname.replace(/^www\./, ""),
      path: rest.length > 60 ? `${rest.slice(0, 59)}…` : rest,
    });
    if (previews.length >= max) break;
  }
  return previews;
}

/**
 * A link typed into the composer's "Add link" box, as text for the post:
 * http(s) only, with https:// added to a bare "example.com/page". The server
 * still applies its link rules (new accounts, at most two, blocked hosts).
 */
export function normaliseLinkInput(raw: string): { ok: true; href: string } | { ok: false; reason: string } {
  const text = raw.trim();
  if (!text) return { ok: false, reason: "Paste a link first." };
  if (/\s/.test(text)) return { ok: false, reason: "A link can't contain spaces." };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: "That doesn't look like a link." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "Only http and https links can be posted." };
  if (!url.hostname.includes(".") || url.username || url.password) return { ok: false, reason: "That doesn't look like a link." };
  return { ok: true, href: url.toString() };
}

export function tokenize(body: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;

  for (const match of body.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    let value = match[0];

    // Trailing punctuation belongs to the sentence, not the token.
    const trailing = value.match(/[.,!?;:)\]]+$/)?.[0] ?? "";
    if (trailing && !match[2]) value = value.slice(0, value.length - trailing.length);

    if (index > last) tokens.push({ type: "text", value: body.slice(last, index) });

    if (match[1]) {
      tokens.push({ type: "cashtag", value, symbol: value.slice(1).replace(/[.-]+$/, "").toUpperCase() });
    } else if (match[2]) {
      tokens.push({ type: "mention", value, handle: value.slice(1).toLowerCase() });
    } else {
      let safe: string | null = null;
      try {
        const url = new URL(value);
        safe = url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
      } catch {
        safe = null;
      }
      tokens.push(safe ? { type: "link", value, href: safe } : { type: "text", value });
    }

    last = index + value.length;
  }

  if (last < body.length) tokens.push({ type: "text", value: body.slice(last) });

  return tokens;
}
