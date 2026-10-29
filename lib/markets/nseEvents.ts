import type { NseListing } from "../apis/nseEquityMaster";
import { parseRss } from "../news/rss";

/**
 * NSE's corporate-action and board-meeting announcements, read from its
 * public RSS feeds, and the exact company each one is about.
 *
 *   Corporate_action.xml  "Genus Power Infrastructures Limited - Ex-Date: 30-Oct-2026"
 *                         "SERIES:EQ |PURPOSE:BUY BACK |FACE VALUE:1 |RECORD DATE:30-Oct-2026 |…"
 *   Board_Meetings.xml    "Rico Auto Industries Limited"
 *                         "Financial Results |Meeting Date: 06-Nov-2026"
 *
 * Neither feed carries an ISIN, and the corporate-action feed has no symbol
 * at all, so mapNseEvent links an item to a listing only when the evidence is
 * exact: the NSE symbol in a filing's file name, or a company name equal to
 * exactly one name in NSE's equity list (lib/apis/nseEquityMaster.ts). Anything
 * else is "unmapped", never a closest match. Feed text is untrusted: values
 * come back as plain text (lib/news/rss.ts), and nothing here is rendered as HTML.
 *
 * Both feeds are rolling windows of the latest ~20 items (about six hours on
 * 29 Oct 2026), so a reader has to poll often to see every item.
 */

export const NSE_CORPORATE_ACTIONS_URL = "https://nsearchives.nseindia.com/content/RSS/Corporate_action.xml";
export const NSE_BOARD_MEETINGS_URL = "https://nsearchives.nseindia.com/content/RSS/Board_Meetings.xml";

export type CorporateActionKind = "dividend" | "buyback" | "split" | "bonus" | "rights" | "other";

export type NseCorporateAction = {
  company: string;
  kind: CorporateActionKind;
  /** NSE's own wording, e.g. "INTERIM DIVIDEND - RS 9.50 PER SHARE". */
  purpose: string;
  series: string | null;
  exDate: string | null;
  recordDate: string | null;
  /** When NSE published it, ISO with the IST offset. */
  publishedAt: string | null;
  link: string;
};

export type NseBoardMeeting = {
  company: string;
  /** NSE's own wording, e.g. "Financial Results/Dividend". */
  purpose: string;
  /** Whether the meeting is to consider financial results. */
  results: boolean;
  meetingDate: string | null;
  publishedAt: string | null;
  /** The filing (PDF or XBRL) on nsearchives. */
  link: string;
};

const MONTHS: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** "30-Oct-2026" → "2026-10-30"; null for "-" or anything else. */
export function nseDate(value: string | null | undefined): string | null {
  const match = (value ?? "").trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  const month = match && MONTHS[match[2].toUpperCase()];
  return match && month ? `${match[3]}-${month}-${match[1]}` : null;
}

/** "28-Oct-2026 06:10:16" (NSE publishes in IST) → "2026-10-28T06:10:16+05:30". */
export function nseTimestamp(value: string | null | undefined): string | null {
  const match = (value ?? "").trim().match(/^(\d{2}-[A-Za-z]{3}-\d{4})\s+(\d{2}:\d{2}:\d{2})$/);
  const date = match && nseDate(match[1]);
  return match && date ? `${date}T${match[2]}+05:30` : null;
}

/** "SERIES:EQ |PURPOSE:BUY BACK |…" → { SERIES: "EQ", PURPOSE: "BUY BACK", … }. */
function fields(description: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of description.split("|")) {
    const colon = part.indexOf(":");
    if (colon > 0) out[part.slice(0, colon).trim().toUpperCase()] = part.slice(colon + 1).trim();
  }
  return out;
}

export function corporateActionKind(purpose: string): CorporateActionKind {
  if (/dividend/i.test(purpose)) return "dividend";
  if (/buy\s*back/i.test(purpose)) return "buyback";
  if (/split|sub-?division/i.test(purpose)) return "split";
  if (/bonus/i.test(purpose)) return "bonus";
  if (/rights/i.test(purpose)) return "rights";
  return "other";
}

export function parseCorporateActions(xml: string): NseCorporateAction[] {
  return parseRss(xml).flatMap((item) => {
    const title = item.title.match(/^(.*?)\s+-\s+Ex-Date:\s*(\S+)\s*$/i);
    const company = (title ? title[1] : item.title).trim();
    if (!company) return [];
    const f = fields(item.description);
    const purpose = f.PURPOSE ?? "";
    return [{
      company,
      kind: corporateActionKind(purpose),
      purpose,
      series: f.SERIES || null,
      exDate: nseDate(title?.[2]),
      recordDate: nseDate(f["RECORD DATE"]),
      publishedAt: nseTimestamp(item.pubDate),
      link: item.link,
    }];
  });
}

export function parseBoardMeetings(xml: string): NseBoardMeeting[] {
  return parseRss(xml).flatMap((item) => {
    const company = item.title.trim();
    if (!company) return [];
    const match = item.description.match(/^(.*?)\s*\|\s*Meeting Date:\s*(\S+)\s*$/i);
    const purpose = (match ? match[1] : item.description).trim();
    return [{
      company,
      purpose,
      results: /financial results/i.test(purpose),
      meetingDate: nseDate(match?.[2]),
      publishedAt: nseTimestamp(item.pubDate),
      link: item.link,
    }];
  });
}

/* ------------------------------------------------------------ mapping */

/**
 * A company name as NSE writes it, reduced to compare equal across NSE's own
 * files: case, "&amp;", punctuation and the legal form ("Limited", "Ltd")
 * don't matter; every other word does.
 */
export function normaliseCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/\b(?:limited|ltd)\b\.?/g, " ")
    .replace(/[^a-z0-9&]+/g, " ")
    .trim();
}

export type NseMasterIndex = {
  bySymbol: Map<string, NseListing>;
  /** Normalised name → every listing with that name (more than one means ambiguous). */
  byName: Map<string, NseListing[]>;
};

export function indexNseMaster(listings: NseListing[]): NseMasterIndex {
  const bySymbol = new Map<string, NseListing>();
  const byName = new Map<string, NseListing[]>();
  for (const listing of listings) {
    bySymbol.set(listing.symbol, listing);
    const key = normaliseCompanyName(listing.name);
    byName.set(key, [...(byName.get(key) ?? []), listing]);
  }
  return { bySymbol, byName };
}

/**
 * The NSE symbol a filing's file name starts with:
 * ".../corporate/RICOAUTO_29102026110542_RICOPriorIntimation06112026Signed.pdf" → "RICOAUTO".
 * Only nsearchives filings, in that exact SYMBOL_DDMMYYYYhhmmss_ shape.
 */
export function symbolFromFilingLink(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.hostname !== "nsearchives.nseindia.com") return null;
  return url.pathname.match(/^\/corporate\/([A-Z0-9&-]{1,20})_\d{14}_[^/]+$/)?.[1] ?? null;
}

export type EventMapping =
  | { status: "mapped"; symbol: string; isin: string; name: string; via: "filing" | "name" }
  | { status: "unmapped"; reason: "not_listed" | "ambiguous" | "conflict" };

/**
 * The listing an announcement is about, or why it can't be said exactly.
 *
 *   - the filing's file name gives a symbol in the equity list → mapped, unless
 *     the company name points at a different listing (conflict);
 *   - otherwise the company name must equal exactly one listing's name;
 *   - no such listing (an SME company, a new listing) → not_listed; two
 *     listings with the same name → ambiguous.
 */
export function mapNseEvent(item: { company: string; link?: string | null }, master: NseMasterIndex): EventMapping {
  const byName = master.byName.get(normaliseCompanyName(item.company)) ?? [];
  const filed = item.link ? symbolFromFilingLink(item.link) : null;
  const listing = filed ? master.bySymbol.get(filed) : undefined;

  if (listing) {
    if (byName.length > 0 && !byName.some((candidate) => candidate.symbol === listing.symbol)) {
      return { status: "unmapped", reason: "conflict" };
    }
    return { status: "mapped", symbol: listing.symbol, isin: listing.isin, name: listing.name, via: "filing" };
  }

  if (byName.length === 1) {
    const [only] = byName;
    return { status: "mapped", symbol: only.symbol, isin: only.isin, name: only.name, via: "name" };
  }
  return { status: "unmapped", reason: byName.length > 1 ? "ambiguous" : "not_listed" };
}
