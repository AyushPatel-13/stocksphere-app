import { getUpstoxIpoDetail, getUpstoxIpos, type UpstoxErrorCode, type UpstoxIpoStatus, type UpstoxResult } from "../apis/upstox";
import { fetchFeed } from "../apis/rssFeed";
import { getUpstoxHistoricalCandles, type UpstoxCandleRow } from "../apis/upstoxHistorical";
import { parseFeedDate, parseRss } from "../news/rss";
import {
  changePct,
  daysBetween,
  demandLevel,
  headlineMentions,
  indiaDateKey,
  ipoSection,
  listingSession,
  matchGmpRow,
  minInvestment,
  newsPhrase,
  percentOf,
  type DailyCandle,
  type Demand,
  type GmpRow,
  type IpoSection,
  type ListingSession,
} from "./ipoMetrics";
import {
  parseUpstoxIpoDetail,
  parseUpstoxIpoList,
  type IpoBoard,
  type PriceBand,
  type UpstoxIpo,
  type UpstoxIpoDetail,
  type UpstoxIpoTimeline,
} from "./ipoParse";

/**
 * Indian IPOs (mainboard and SME, NSE and BSE) for the IPO page.
 *
 *   Calendar, price band, lot, issue size, subscription,   Upstox IPO API (official):
 *   allotment and listing dates, listing price             GET /v2/ipos, GET /v2/ipos/{id}
 *   Listing-day close and latest close                     Upstox daily candles (by ISIN)
 *   News                                                   ET Markets IPO RSS,
 *                                                          Business Standard Markets RSS
 *   Grey market premium                                    optional provider — none configured
 *
 * Issues are sorted into Open / Upcoming / Closed from their subscription
 * dates in Indian time, not from Upstox's status word (which was seen saying
 * "open" the evening before bidding started). Issues without dates are listed
 * separately with the reason. Closed issues are kept for RECENT_DAYS.
 */

export const RECENT_DAYS = 30;
const BOARD_TTL_MS = 2 * 60_000;
/** A failed refresh may serve the last good board for this long, flagged as stale. */
const STALE_LIMIT_MS = 30 * 60_000;
const NEWS_TTL_MS = 10 * 60_000;
const LISTING_TTL_MS = 60 * 60_000;
const DETAIL_CONCURRENCY = 4;
/** One retry, after this pause, when Upstox rate-limits or times out a details call. */
const RETRY_DELAY_MS = 1_000;
/** Pages per status; listed IPOs stop earlier, once a page is older than the window. */
const MAX_PAGES: Record<UpstoxIpoStatus, number> = { open: 3, upcoming: 3, closed: 3, listed: 6 };

export const UPSTOX_IPO_DOCS = "https://upstox.com/developer/api-documentation/get-ipos/";

export const IPO_NEWS_FEEDS = [
  { id: "et", name: "ET Markets — IPOs", url: "https://economictimes.indiatimes.com/markets/ipos/fpos/rssfeeds/14655708.cms", ipoOnly: true },
  { id: "bs", name: "Business Standard — Markets", url: "https://www.business-standard.com/rss/markets-106.rss", ipoOnly: false },
] as const;

export const UPSTOX_ERROR_MESSAGES: Record<UpstoxErrorCode, string> = {
  not_configured: "Upstox isn't configured on this server (UPSTOX_ACCESS_TOKEN is not set), so IPO data can't be loaded.",
  auth: "Upstox rejected the access token — it has probably expired (Upstox tokens expire daily). Generate a new token and update UPSTOX_ACCESS_TOKEN.",
  rate_limited: "Upstox is rate-limiting requests right now. Try again in a minute.",
  timeout: "Upstox didn't answer in time. Try again shortly.",
  not_found: "Upstox has no data for this IPO.",
  provider: "Upstox's IPO service returned an error. Try again shortly.",
};

/** Shown when no GMP provider is configured — which is the case today. */
export const GMP_UNAVAILABLE_REASON =
  "Upstox's IPO API has no grey market premium, and no GMP source whose terms permit republishing is configured. " +
  "GMP is unofficial data; it is never estimated here.";

export type SourceStatus = {
  id: string;
  name: string;
  url: string;
  ok: boolean;
  fetchedAt: string;
  note?: string;
};

export type IpoGmp = {
  /** ₹ per share, as the provider reports it. */
  value: number;
  pctOfUpper: number | null;
  /** The name the provider lists it under. */
  sourceName: string;
};

export type GmpStatus = {
  available: boolean;
  providerName: string | null;
  providerUrl: string | null;
  updatedAt: string | null;
  reason: string | null;
};

/** Optional GMP provider. Kept apart from Upstox data; none is configured by default. */
export type GmpSnapshot = { providerName: string; providerUrl: string; updatedAt: string | null; rows: GmpRow[] };

export type IpoListingSession = ListingSession & { listingDayClosePct: number | null; latestPct: number | null };

export type IpoRow = {
  id: string;
  symbol: string | null;
  name: string;
  isin: string | null;
  board: IpoBoard;
  industry: string | null;
  /** Upstox's own status word, for reference. */
  providerStatus: string | null;
  section: IpoSection;
  /**
   * Closed issues only: "listed" (listing price known, listing date passed, or
   * Upstox lists it as listed), "awaiting" (details say none of those), or
   * null when the details are unavailable and Upstox does not say "listed".
   */
  listingState: "listed" | "awaiting" | null;
  openDate: string;
  closeDate: string;
  dailyStartTime: string | null;
  dailyEndTime: string | null;
  priceBand: PriceBand | null;
  cutOffPrice: number | null;
  faceValue: number | null;
  lotSize: number | null;
  minimumQuantity: number | null;
  /** Minimum quantity × upper price band. */
  minInvestment: number | null;
  issueSizeCr: number | null;
  /** Overall times subscribed (Upstox); null before bidding opens or when absent. */
  subscription: number | null;
  demand: Demand;
  timeline: UpstoxIpoTimeline | null;
  listingExchanges: string[];
  listingPrice: number | null;
  /** Listing price vs cut-off (issue) price, %. */
  listingGainPct: number | null;
  session: IpoListingSession | null;
  rhpUrl: string | null;
  drhpUrl: string | null;
  gmp: IpoGmp | null;
  /** False when the details call failed and only list fields are shown. */
  detailOk: boolean;
};

export type UnclassifiedIpo = { id: string; name: string; board: IpoBoard; providerStatus: string | null; reason: string };

export type IpoBoardData = {
  ipos: IpoRow[];
  unclassified: UnclassifiedIpo[];
  /** Today's date in India, used for the sections. */
  today: string;
  generatedAt: string;
  /** Set when a refresh failed and an older board is being served. */
  staleReason: string | null;
  gmp: GmpStatus;
  sources: SourceStatus[];
};

export type IpoBoardResult = { ok: true; data: IpoBoardData } | { ok: false; code: UpstoxErrorCode; message: string };

export type IpoNewsItem = { id: string; title: string; url: string; sourceName: string; publishedAt: string | null };

export type IpoNewsData = {
  items: IpoNewsItem[];
  /** Headlines mentioning each issue, by Upstox IPO id. */
  byId: Record<string, IpoNewsItem[]>;
  /** Headlines in the last 7 days per IPO id. */
  weekCount: Record<string, number>;
  sources: SourceStatus[];
  fetchedAt: string;
};

export interface IpoDeps {
  listIpos: typeof getUpstoxIpos;
  ipoDetail: (id: string) => Promise<UpstoxResult>;
  getCandles: (key: string, from: string, to: string) => Promise<UpstoxCandleRow[] | null>;
  getGmp: (() => Promise<GmpSnapshot | null>) | null;
  fetchText: (url: string) => Promise<string | null>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_DEPS: IpoDeps = {
  listIpos: getUpstoxIpos,
  ipoDetail: getUpstoxIpoDetail,
  getCandles: async (key, from, to) => {
    try {
      return await getUpstoxHistoricalCandles(key, from, to);
    } catch {
      return null; // no token configured
    }
  },
  // No GMP provider: none found whose terms permit republishing (see GMP_UNAVAILABLE_REASON).
  getGmp: null,
  fetchText: fetchFeed,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/* ------------------------------------------------------------ helpers */

/** Upstox rows [timestamp, open, high, low, close, volume, oi] → candles. */
export function upstoxRowsToCandles(rows: UpstoxCandleRow[]): DailyCandle[] {
  const out: DailyCandle[] = [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  for (const row of rows) {
    if (!Array.isArray(row) || typeof row[0] !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(row[0])) continue;
    out.push({ date: row[0].slice(0, 10), open: num(row[1]), close: num(row[4]) });
  }
  return out;
}

async function mapLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await task(items[next++]);
    })
  );
}

/* ------------------------------------------------------------ caches */

const detailCache = new Map<string, { at: number; ttl: number; detail: UpstoxIpoDetail }>();
const sessionCache = new Map<string, { at: number; session: ListingSession | null }>();
let boardCache: { at: number; data: IpoBoardData } | null = null;
let boardInFlight: Promise<IpoBoardResult> | null = null;
let newsCache: { at: number; data: IpoNewsData } | null = null;

/** Test hook. */
export function clearIpoCache() {
  detailCache.clear();
  sessionCache.clear();
  boardCache = null;
  boardInFlight = null;
  newsCache = null;
}

/* ------------------------------------------------------------ fetching */

type ListOutcome = { status: UpstoxIpoStatus; items: UpstoxIpo[]; error: UpstoxErrorCode | null };

/**
 * Every page of one status. Listed IPOs come newest first, so paging stops
 * once a page's oldest issue closed before the window.
 */
async function fetchStatus(status: UpstoxIpoStatus, today: string, deps: IpoDeps): Promise<ListOutcome> {
  const items: UpstoxIpo[] = [];
  for (let page = 1; page <= MAX_PAGES[status]; page++) {
    const result = await deps.listIpos({ status, pageNumber: page, records: 30 });
    if (!result.ok) return { status, items, error: result.code };
    const parsed = parseUpstoxIpoList(result.body);
    if (!parsed) return { status, items, error: "provider" };
    items.push(...parsed.items);
    if (!parsed.page || parsed.page.pageNumber >= parsed.page.totalPages) break;
    if (status === "listed") {
      const oldest = parsed.items.at(-1)?.closeDate;
      if (oldest && daysBetween(oldest, today) > RECENT_DAYS) break;
    }
  }
  return { status, items, error: null };
}

function detailTtl(section: IpoSection | null): number {
  return section === "open" ? 2 * 60_000 : 30 * 60_000;
}

async function loadDetail(
  item: UpstoxIpo,
  today: string,
  deps: IpoDeps,
  failures: Map<UpstoxErrorCode, number>
): Promise<UpstoxIpoDetail | null> {
  const hit = detailCache.get(item.id);
  if (hit && deps.now() - hit.at < hit.ttl) return hit.detail;
  let result = await deps.ipoDetail(item.id);
  if (!result.ok && (result.code === "rate_limited" || result.code === "timeout")) {
    await deps.sleep(RETRY_DELAY_MS);
    result = await deps.ipoDetail(item.id);
  }
  const detail = result.ok ? parseUpstoxIpoDetail(result.body) : null;
  if (!detail) {
    const code: UpstoxErrorCode = result.ok ? "provider" : result.code;
    failures.set(code, (failures.get(code) ?? 0) + 1);
    return hit?.detail ?? null; // keep the last good detail on a failed refresh
  }
  // Listed issues barely change; open ones change by the minute.
  const listed = detail.listingPrice !== null;
  detailCache.set(item.id, { at: deps.now(), ttl: listed ? 6 * 60 * 60_000 : detailTtl(ipoSection(detail, today).section), detail });
  return detail;
}

/** Upstox instrument keys accept an ISIN: NSE when the issue lists there, else BSE. */
function instrumentKey(isin: string | null, exchanges: string[]): string | null {
  if (!isin) return null;
  return `${exchanges.includes("NSE") || exchanges.length === 0 ? "NSE" : "BSE"}_EQ|${isin}`;
}

async function loadSession(
  id: string,
  key: string | null,
  listingDate: string | null,
  today: string,
  deps: IpoDeps
): Promise<ListingSession | null> {
  if (!key || !listingDate || listingDate > today) return null;
  const hit = sessionCache.get(id);
  if (hit && deps.now() - hit.at < LISTING_TTL_MS) return hit.session;
  const rows = await deps.getCandles(key, listingDate, today);
  const session = rows ? listingSession(listingDate, upstoxRowsToCandles(rows)) : null;
  if (session) sessionCache.set(id, { at: deps.now(), session });
  return session;
}

/* ------------------------------------------------------------ board */

export function listingStateOf(
  listingPrice: number | null,
  listingDate: string | null,
  providerStatus: string | null,
  haveDetail: boolean,
  today: string
): "listed" | "awaiting" | null {
  if (listingPrice !== null || (listingDate !== null && listingDate <= today) || providerStatus === "listed") return "listed";
  return haveDetail ? "awaiting" : null;
}

const SECTION_ORDER: Record<IpoSection, number> = { open: 0, upcoming: 1, closed: 2 };
const ERROR_PRIORITY: UpstoxErrorCode[] = ["not_configured", "auth", "rate_limited", "timeout", "provider", "not_found"];

export async function buildIpoBoard(deps: IpoDeps = DEFAULT_DEPS): Promise<IpoBoardResult> {
  const now = deps.now();
  const fetchedAt = new Date(now).toISOString();
  const today = indiaDateKey(now);

  const statuses: UpstoxIpoStatus[] = ["open", "upcoming", "closed", "listed"];
  const [outcomes, gmpSnapshot] = await Promise.all([
    Promise.all(statuses.map((s) => fetchStatus(s, today, deps))),
    deps.getGmp ? deps.getGmp().catch(() => null) : Promise.resolve(null),
  ]);

  const errors = outcomes.map((o) => o.error).filter((e): e is UpstoxErrorCode => e !== null);
  // A missing or expired token fails every call: say so instead of showing a partial board.
  const fatal = ERROR_PRIORITY.find((code) => (code === "not_configured" || code === "auth") && errors.includes(code));
  if (fatal || errors.length === statuses.length) {
    const code = fatal ?? ERROR_PRIORITY.find((c) => errors.includes(c)) ?? "provider";
    return { ok: false, code, message: UPSTOX_ERROR_MESSAGES[code] };
  }

  // One entry per IPO id (the status lists should not overlap, but never double-count).
  const byId = new Map<string, UpstoxIpo>();
  for (const outcome of outcomes) for (const item of outcome.items) if (!byId.has(item.id)) byId.set(item.id, item);

  // Closed issues outside the window are dropped before any detail call.
  const inWindow = [...byId.values()].filter((item) => !item.closeDate || daysBetween(item.closeDate, today) <= RECENT_DAYS);

  const details = new Map<string, UpstoxIpoDetail>();
  const detailFailureCodes = new Map<UpstoxErrorCode, number>();
  await mapLimited(inWindow, DETAIL_CONCURRENCY, async (item) => {
    const detail = await loadDetail(item, today, deps, detailFailureCodes);
    if (detail) details.set(item.id, detail);
  });

  const unclassified: UnclassifiedIpo[] = [];
  const classified: { item: UpstoxIpo; detail: UpstoxIpoDetail | null; section: IpoSection }[] = [];
  for (const item of inWindow) {
    const detail = details.get(item.id) ?? null;
    const merged = detail ?? item;
    const result = ipoSection(merged, today);
    if (result.section === null) {
      unclassified.push({ id: item.id, name: merged.name, board: merged.board, providerStatus: merged.providerStatus, reason: result.reason });
    } else if (result.section !== "closed" || daysBetween(merged.closeDate!, today) <= RECENT_DAYS) {
      classified.push({ item, detail, section: result.section });
    }
  }

  const sessions = new Map<string, ListingSession>();
  await mapLimited(classified, DETAIL_CONCURRENCY, async ({ item, detail, section }) => {
    if (section !== "closed" || !detail) return;
    const session = await loadSession(item.id, instrumentKey(detail.isin, detail.listingExchanges), detail.timeline.listingDate, today, deps);
    if (session) sessions.set(item.id, session);
  });

  const rows = classified.map(({ item, detail, section }): IpoRow => {
    const d = detail ?? item;
    const subscription = section === "upcoming" ? null : (detail?.totalSubscription ?? item.totalSubscription);
    const listingDate = detail?.timeline.listingDate ?? null;
    const listingPrice = detail?.listingPrice ?? null;
    const cutOff = detail?.cutOffPrice ?? null;
    const session = sessions.get(item.id) ?? null;
    const gmpRow =
      gmpSnapshot && section !== "closed" ? matchGmpRow({ name: d.name, board: d.board, priceUpper: d.priceBand?.high ?? null }, gmpSnapshot.rows) : null;

    return {
      id: item.id,
      symbol: d.symbol,
      name: d.name,
      isin: d.isin,
      board: d.board,
      industry: d.industry,
      providerStatus: d.providerStatus,
      section,
      listingState: section === "closed" ? listingStateOf(listingPrice, listingDate, d.providerStatus, detail !== null, today) : null,
      openDate: d.openDate!,
      closeDate: d.closeDate!,
      dailyStartTime: detail?.dailyStartTime ?? null,
      dailyEndTime: detail?.dailyEndTime ?? null,
      priceBand: d.priceBand,
      cutOffPrice: cutOff,
      faceValue: detail?.faceValue ?? null,
      lotSize: detail?.lotSize ?? null,
      minimumQuantity: detail?.minimumQuantity ?? null,
      minInvestment: minInvestment(detail?.minimumQuantity ?? null, d.priceBand),
      issueSizeCr: d.issueSizeCr,
      subscription,
      demand: demandLevel(section, subscription),
      timeline: detail?.timeline ?? null,
      listingExchanges: detail?.listingExchanges ?? [],
      listingPrice,
      listingGainPct: changePct(listingPrice, cutOff),
      session: session
        ? { ...session, listingDayClosePct: changePct(session.listingDayClose, cutOff), latestPct: changePct(session.latestClose, cutOff) }
        : null,
      rhpUrl: detail?.rhpUrl ?? null,
      drhpUrl: detail?.drhpUrl ?? null,
      gmp:
        gmpRow && gmpRow.gmp !== null
          ? { value: gmpRow.gmp, pctOfUpper: percentOf(gmpRow.gmp, d.priceBand?.high ?? null), sourceName: gmpRow.name }
          : null,
      detailOk: detail !== null,
    };
  });

  rows.sort(
    (a, b) =>
      SECTION_ORDER[a.section] - SECTION_ORDER[b.section] ||
      // upcoming: soonest first; open: closing soonest first; closed: most recent first
      (a.section === "closed" ? b.closeDate.localeCompare(a.closeDate) : a.openDate.localeCompare(b.openDate) || a.closeDate.localeCompare(b.closeDate)) ||
      a.name.localeCompare(b.name)
  );

  const detailFailures = inWindow.length - details.size;
  const listed = rows.filter((r) => r.listingState === "listed");
  const withSession = listed.filter((r) => r.session).length;
  const listErrors = outcomes.filter((o) => o.error);

  return {
    ok: true,
    data: {
      ipos: rows,
      unclassified,
      today,
      generatedAt: fetchedAt,
      staleReason: null,
      gmp: gmpSnapshot
        ? { available: true, providerName: gmpSnapshot.providerName, providerUrl: gmpSnapshot.providerUrl, updatedAt: gmpSnapshot.updatedAt, reason: null }
        : { available: false, providerName: null, providerUrl: null, updatedAt: null, reason: GMP_UNAVAILABLE_REASON },
      sources: [
        {
          id: "upstox-list",
          name: "Upstox IPO API — Get IPOs (open, upcoming, closed, listed)",
          url: UPSTOX_IPO_DOCS,
          ok: listErrors.length === 0,
          fetchedAt,
          note: listErrors.length ? listErrors.map((o) => `${o.status}: ${UPSTOX_ERROR_MESSAGES[o.error!]}`).join(" ") : undefined,
        },
        {
          id: "upstox-detail",
          name: "Upstox IPO API — Get IPO Details",
          url: "https://upstox.com/developer/api-documentation/get-ipo-details/",
          ok: detailFailures === 0,
          fetchedAt,
          note: detailFailures
            ? `${detailFailures} of ${inWindow.length} issues' details unavailable (${[...detailFailureCodes].map(([c, n]) => `${c} ×${n}`).join(", ")}); list fields shown`
            : undefined,
        },
        {
          id: "upstox-candles",
          name: "Upstox daily candles (listing-day and latest close)",
          url: "https://upstox.com/developer/api-documentation/v3/get-historical-candle-data",
          ok: withSession === listed.length,
          fetchedAt,
          note: listed.length ? `${withSession} of ${listed.length} listed issues have candles` : undefined,
        },
      ],
    },
  };
}

/**
 * Cached for BOARD_TTL_MS. When a refresh fails, the last good board (up to
 * STALE_LIMIT_MS old) is served with `staleReason` set, except for token
 * problems, which are always reported.
 */
export async function getIpoBoard(deps: IpoDeps = DEFAULT_DEPS): Promise<IpoBoardResult> {
  if (boardCache && deps.now() - boardCache.at < BOARD_TTL_MS) return { ok: true, data: boardCache.data };
  if (!boardInFlight) {
    boardInFlight = buildIpoBoard(deps)
      .then((result): IpoBoardResult => {
        if (result.ok) {
          boardCache = { at: deps.now(), data: result.data };
          return result;
        }
        const tokenProblem = result.code === "auth" || result.code === "not_configured";
        if (!tokenProblem && boardCache && deps.now() - boardCache.at < STALE_LIMIT_MS) {
          return { ok: true, data: { ...boardCache.data, staleReason: result.message } };
        }
        return result;
      })
      .finally(() => {
        boardInFlight = null;
      });
  }
  return boardInFlight;
}

/* ------------------------------------------------------------ news */

export function buildIpoNews(
  feeds: { id: string; name: string; url: string; ipoOnly: boolean; xml: string | null }[],
  issues: { id: string; name: string }[],
  nowMs: number
): IpoNewsData {
  const fetchedAt = new Date(nowMs).toISOString();
  const all: (IpoNewsItem & { ipoOnly: boolean })[] = [];
  const seen = new Set<string>();
  const sources: SourceStatus[] = [];

  for (const feed of feeds) {
    const parsed = feed.xml ? parseRss(feed.xml) : null;
    let count = 0;
    for (const item of parsed ?? []) {
      if (!item.title || !/^https?:\/\//.test(item.link) || seen.has(item.link)) continue;
      seen.add(item.link);
      all.push({ id: item.guid || item.link, title: item.title, url: item.link, sourceName: feed.name, publishedAt: parseFeedDate(item.pubDate), ipoOnly: feed.ipoOnly });
      count++;
    }
    sources.push({ id: feed.id, name: feed.name, url: feed.url, ok: Boolean(parsed && parsed.length), fetchedAt, note: parsed ? `${count} headlines` : "Feed unavailable" });
  }

  all.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  const strip = (item: IpoNewsItem): IpoNewsItem => ({ id: item.id, title: item.title, url: item.url, sourceName: item.sourceName, publishedAt: item.publishedAt });

  const byId: Record<string, IpoNewsItem[]> = {};
  const weekCount: Record<string, number> = {};
  const weekAgo = new Date(nowMs - 7 * 86_400_000).toISOString();
  for (const issue of issues) {
    const phrase = newsPhrase(issue.name);
    if (!phrase) continue;
    const hits = all.filter((item) => headlineMentions(item.title, phrase));
    byId[issue.id] = hits.slice(0, 6).map(strip);
    weekCount[issue.id] = hits.filter((h) => h.publishedAt !== null && h.publishedAt >= weekAgo).length;
  }

  const items = all.filter((item) => item.ipoOnly || /\bIPOs?\b/i.test(item.title)).slice(0, 40).map(strip);
  return { items, byId, weekCount, sources, fetchedAt };
}

export async function getIpoNews(deps: IpoDeps = DEFAULT_DEPS): Promise<IpoNewsData | null> {
  if (newsCache && deps.now() - newsCache.at < NEWS_TTL_MS) return newsCache.data;
  const [board, ...xmls] = await Promise.all([getIpoBoard(deps), ...IPO_NEWS_FEEDS.map((f) => deps.fetchText(f.url))]);
  if (xmls.every((x) => !x)) return newsCache?.data ?? null;
  const data = buildIpoNews(
    IPO_NEWS_FEEDS.map((f, i) => ({ ...f, xml: xmls[i] })),
    board.ok ? board.data.ipos : [],
    deps.now()
  );
  newsCache = { at: deps.now(), data };
  return data;
}
