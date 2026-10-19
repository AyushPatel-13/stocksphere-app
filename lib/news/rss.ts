/**
 * A small RSS 2.0 reader for the publisher feeds the news page uses (NSE, ET
 * Markets, Business Standard).
 *
 * Deliberately narrow: it reads <item> title / link / description / pubDate /
 * guid and nothing else, and every value comes back as plain text — tags are
 * stripped and entities decoded — so nothing from a feed is ever rendered as
 * HTML.
 */

export type RssItem = {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  guid: string;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rupee: "₹",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1].toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : "";
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** CDATA unwrapped, entities decoded, tags removed, whitespace collapsed. */
export function toPlainText(raw: string): string {
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // Decode first: feeds often escape their HTML (&lt;img …&gt;), and those
  // tags must be stripped too, not shown as text.
  const decoded = decodeEntities(unwrapped);
  return decoded
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return match ? toPlainText(match[1]) : "";
}

export function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];

  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];

    items.push({
      title: tag(block, "title"),
      link: tag(block, "link"),
      description: tag(block, "description"),
      pubDate: tag(block, "pubDate"),
      guid: tag(block, "guid"),
    });
  }

  return items;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * A feed date as ISO, or null.
 *
 * Handles RFC 822 ("Mon, 19 Oct 2026 11:29:10 +0530") and NSE's own format
 * ("19-Oct-2026 12:12:10"), which carries no zone and is Indian time.
 */
export function parseFeedDate(value: string): string | null {
  const nse = value.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);

  if (nse) {
    const month = MONTHS[nse[2].toLowerCase()];
    if (month === undefined) return null;

    // IST is UTC+05:30 all year.
    const utc =
      Date.UTC(
        Number(nse[3]),
        month,
        Number(nse[1]),
        Number(nse[4]),
        Number(nse[5]),
        Number(nse[6] ?? 0)
      ) -
      (5 * 60 + 30) * 60_000;
    return new Date(utc).toISOString();
  }

  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}
