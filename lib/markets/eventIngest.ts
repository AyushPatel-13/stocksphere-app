import { createHash } from "node:crypto";

import { getNseEquityMaster, type NseListing } from "../apis/nseEquityMaster";
import { getAdminClient, getPublicClient } from "../supabase/server";
import {
  NSE_BOARD_MEETINGS_URL,
  NSE_CORPORATE_ACTIONS_URL,
  indexNseMaster,
  mapNseEvent,
  parseBoardMeetings,
  parseCorporateActions,
  type NseBoardMeeting,
  type NseCorporateAction,
} from "./nseEvents";

/**
 * NSE announcements into market_events, and read back out.
 *
 * Both NSE feeds are rolling windows of the latest ~20 items, so ingest runs
 * whenever the events API is read (at most once per INGEST_EVERY_MS per
 * server instance) as well as from the daily job. Each item is stored once:
 * raw_hash is unique, and an insert that hits it is ignored. An item whose
 * company can't be matched exactly is stored as unmapped with the reason,
 * never linked to a guessed listing.
 */

export type MarketEventSource = "nse_corporate_actions" | "nse_board_meetings";
export type MarketEventKind = "dividend" | "buyback" | "split" | "bonus" | "rights" | "other" | "results" | "board_meeting";

export type MarketEventRow = {
  source: MarketEventSource;
  kind: MarketEventKind;
  company_name: string;
  mapping_status: "mapped" | "unmapped";
  unmapped_reason: "not_listed" | "ambiguous" | "conflict" | null;
  symbol: string | null;
  isin: string | null;
  exchange: "NSE";
  purpose: string;
  event_date: string | null;
  record_date: string | null;
  published_at: string | null;
  source_url: string;
  raw_hash: string;
};

export type MarketEvent = {
  id: string;
  source: MarketEventSource;
  kind: MarketEventKind;
  company: string;
  mapped: boolean;
  unmappedReason: string | null;
  symbol: string | null;
  isin: string | null;
  exchange: string;
  purpose: string;
  eventDate: string | null;
  recordDate: string | null;
  publishedAt: string | null;
  sourceUrl: string;
};

const NSE_URL = /^https:\/\/[a-z0-9.-]+\.nseindia\.com\//;

/** The item's own link if it is an NSE page, otherwise the feed it came from. */
function safeSourceUrl(link: string, feed: string): string {
  return NSE_URL.test(link) ? link : feed;
}

const clip = (value: string, max: number) => value.trim().slice(0, max);

function rawHash(parts: (string | null)[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function buildEventRows(actions: NseCorporateAction[], meetings: NseBoardMeeting[], master: NseListing[]): MarketEventRow[] {
  const index = indexNseMaster(master);
  const rows: MarketEventRow[] = [];

  const mapped = (company: string, link: string) => {
    const mapping = mapNseEvent({ company, link }, index);
    return mapping.status === "mapped"
      ? { mapping_status: "mapped" as const, unmapped_reason: null, symbol: mapping.symbol, isin: mapping.isin }
      : { mapping_status: "unmapped" as const, unmapped_reason: mapping.reason, symbol: null, isin: null };
  };

  for (const action of actions) {
    const company = clip(action.company, 200);
    if (!company) continue;
    const purpose = clip(action.purpose, 500);
    rows.push({
      source: "nse_corporate_actions",
      kind: action.kind,
      company_name: company,
      ...mapped(company, action.link),
      exchange: "NSE",
      purpose,
      event_date: action.exDate,
      record_date: action.recordDate,
      published_at: action.publishedAt,
      source_url: safeSourceUrl(action.link, NSE_CORPORATE_ACTIONS_URL),
      raw_hash: rawHash(["nse_corporate_actions", company, purpose, action.exDate, action.recordDate, action.series]),
    });
  }

  for (const meeting of meetings) {
    const company = clip(meeting.company, 200);
    if (!company) continue;
    const purpose = clip(meeting.purpose, 500);
    rows.push({
      source: "nse_board_meetings",
      kind: meeting.results ? "results" : "board_meeting",
      company_name: company,
      ...mapped(company, meeting.link),
      exchange: "NSE",
      purpose,
      event_date: meeting.meetingDate,
      record_date: null,
      published_at: meeting.publishedAt,
      source_url: safeSourceUrl(meeting.link, NSE_BOARD_MEETINGS_URL),
      raw_hash: rawHash(["nse_board_meetings", company, purpose, meeting.meetingDate, meeting.link, meeting.publishedAt]),
    });
  }

  // The same item twice in one read (NSE repeats some) is one row.
  const seen = new Set<string>();
  return rows.filter((row) => !seen.has(row.raw_hash) && (seen.add(row.raw_hash), true));
}

export function toMarketEvent(row: MarketEventRow & { id: string }): MarketEvent {
  return {
    id: row.id,
    source: row.source,
    kind: row.kind,
    company: row.company_name,
    mapped: row.mapping_status === "mapped",
    unmappedReason: row.unmapped_reason,
    symbol: row.symbol,
    isin: row.isin,
    exchange: row.exchange,
    purpose: row.purpose,
    eventDate: row.event_date,
    recordDate: row.record_date,
    publishedAt: row.published_at,
    sourceUrl: row.source_url,
  };
}

/**
 * One entry per announced event: NSE files a board meeting both as a PDF and
 * as XBRL, which are two stored items (two raw hashes) but one meeting. The
 * first of each (source, company, kind, purpose, date) is kept, in order.
 */
export function distinctEvents(events: MarketEvent[]): MarketEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = JSON.stringify([event.source, event.company.toLowerCase(), event.kind, event.purpose.toLowerCase(), event.eventDate]);
    return !seen.has(key) && (seen.add(key), true);
  });
}

/* ------------------------------------------------------------ store */

export interface MarketEventStore {
  /** Inserts rows whose raw_hash is new; returns how many were new. */
  insertNew(rows: MarketEventRow[]): Promise<number>;
  list(query: { symbol?: string; from: string; to: string; limit: number }): Promise<MarketEvent[]>;
}

export function getMarketEventStore(): MarketEventStore | null {
  const admin = getAdminClient();
  const reader = getPublicClient();
  if (!admin || !reader) return null;
  return {
    async insertNew(rows) {
      if (rows.length === 0) return 0;
      const { data, error } = await admin
        .from("market_events")
        .upsert(rows, { onConflict: "raw_hash", ignoreDuplicates: true })
        .select("id");
      if (error) throw error;
      return data?.length ?? 0;
    },
    async list({ symbol, from, to, limit }) {
      let query = reader
        .from("market_events")
        .select("id, source, kind, company_name, mapping_status, unmapped_reason, symbol, isin, exchange, purpose, event_date, record_date, published_at, source_url, raw_hash")
        .gte("event_date", from)
        .lte("event_date", to)
        .order("event_date", { ascending: true })
        .order("company_name", { ascending: true })
        .limit(limit);
      if (symbol) query = query.eq("symbol", symbol);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row) => toMarketEvent(row as MarketEventRow & { id: string }));
    },
  };
}

/* ------------------------------------------------------------ ingest */

export type IngestResult = { read: number; inserted: number; unmapped: number; feedsFailed: MarketEventSource[] } | { skipped: "master_unavailable" };

async function readFeed(url: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const response = await fetchImpl(url, {
      headers: { "User-Agent": "Mozilla/5.0 (StockSphere)", Accept: "application/rss+xml,application/xml,text/xml" },
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

export async function ingestNseEvents(
  store: MarketEventStore,
  fetchImpl: typeof fetch = fetch,
  loadMaster: (f: typeof fetch) => Promise<NseListing[] | null> = getNseEquityMaster
): Promise<IngestResult> {
  // Without the equity list nothing can be mapped exactly; store nothing rather than all-unmapped.
  const master = await loadMaster(fetchImpl);
  if (!master) return { skipped: "master_unavailable" };

  const [actionsXml, meetingsXml] = await Promise.all([readFeed(NSE_CORPORATE_ACTIONS_URL, fetchImpl), readFeed(NSE_BOARD_MEETINGS_URL, fetchImpl)]);
  const feedsFailed: MarketEventSource[] = [];
  if (actionsXml === null) feedsFailed.push("nse_corporate_actions");
  if (meetingsXml === null) feedsFailed.push("nse_board_meetings");

  const rows = buildEventRows(actionsXml ? parseCorporateActions(actionsXml) : [], meetingsXml ? parseBoardMeetings(meetingsXml) : [], master);
  const inserted = await store.insertNew(rows);
  return { read: rows.length, inserted, unmapped: rows.filter((row) => row.mapping_status === "unmapped").length, feedsFailed };
}

const INGEST_EVERY_MS = 10 * 60_000;
const RETRY_AFTER_FAILURE_MS = 60_000;
let lastIngestAt = 0;
let running: Promise<unknown> | null = null;

/**
 * Ingests if the last attempt here was more than ten minutes ago. Never
 * throws; waits at most waitMs so a slow NSE doesn't hold up the reader.
 */
export async function ingestIfDue(store: MarketEventStore, now: number = Date.now(), waitMs = 4_000, ingest = ingestNseEvents): Promise<void> {
  if (!running && now - lastIngestAt >= INGEST_EVERY_MS) {
    lastIngestAt = now;
    running = ingest(store)
      .catch((error) => {
        // A failed run is retried after a minute, not after the full interval.
        lastIngestAt = now - INGEST_EVERY_MS + RETRY_AFTER_FAILURE_MS;
        console.error("NSE event ingest failed:", (error as { message?: string })?.message ?? error);
      })
      .finally(() => {
        running = null;
      });
  }
  if (!running) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([running, new Promise((resolve) => (timer = setTimeout(resolve, waitMs)))]);
  clearTimeout(timer);
}

/** Test hook. */
export function resetIngestThrottle() {
  lastIngestAt = 0;
  running = null;
}
