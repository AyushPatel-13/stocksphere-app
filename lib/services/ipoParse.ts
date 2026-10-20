/**
 * Pure parsers for the Upstox IPO API (GET /v2/ipos and GET /v2/ipos/{id}).
 *
 * Only documented fields are read. Each is validated: a date must be a real
 * "YYYY-MM-DD", a price must be a positive number (Upstox sends 0 for "not
 * announced"), a subscription multiple must be a plain decimal string.
 * Anything else becomes null — never a default or a guess.
 */

export type IpoBoard = "mainboard" | "sme";

export type PriceBand = { low: number; high: number };

/** The list endpoint's fields, normalised. */
export type UpstoxIpo = {
  id: string;
  symbol: string | null;
  name: string;
  isin: string | null;
  board: IpoBoard;
  /** Upstox's own status word; shown for reference, not used to classify. */
  providerStatus: string | null;
  industry: string | null;
  /** Total issue size in ₹ crore. */
  issueSizeCr: number | null;
  priceBand: PriceBand | null;
  openDate: string | null;
  closeDate: string | null;
  /** Overall times subscribed, as Upstox reports it. */
  totalSubscription: number | null;
};

export type UpstoxIpoTimeline = {
  allotmentDate: string | null;
  refundDate: string | null;
  listingDate: string | null;
  mandateEndDate: string | null;
};

/** The details endpoint adds these. */
export type UpstoxIpoDetail = UpstoxIpo & {
  dailyStartTime: string | null;
  dailyEndTime: string | null;
  faceValue: number | null;
  lotSize: number | null;
  minimumQuantity: number | null;
  cutOffPrice: number | null;
  listingPrice: number | null;
  /** Upstox's "BSE", "NSE", "BSE,NSE" → ["BSE", "NSE"]. */
  listingExchanges: string[];
  rhpUrl: string | null;
  drhpUrl: string | null;
  timeline: UpstoxIpoTimeline;
};

export type UpstoxPage = { pageNumber: number; totalPages: number };

/* ------------------------------------------------------------ primitives */

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** A real calendar date "YYYY-MM-DD", else null. */
export function parseIsoDate(value: unknown): string | null {
  const s = str(value);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

/** "10:00:00" → "10:00"; else null. */
export function parseClock(value: unknown): string | null {
  const s = str(value);
  const m = s?.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  return m ? `${m[1]}:${m[2]}` : null;
}

/** A positive finite number (number or numeric string); 0, negatives, junk → null. */
export function positiveNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** A positive whole number, else null. */
export function positiveInt(value: unknown): number | null {
  const n = positiveNumber(value);
  return n !== null && Number.isInteger(n) ? n : null;
}

/** Upstox's subscription string: "96.63" → 96.63, "0.0" → 0; junk or null → null. */
export function parseSubscription(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const s = str(value);
  return s && /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/** Both band ends announced (Upstox sends 0 or null until then) and in order. */
export function parsePriceBand(min: unknown, max: unknown): PriceBand | null {
  const low = positiveNumber(min);
  const high = positiveNumber(max);
  return low !== null && high !== null && high >= low ? { low, high } : null;
}

export function boardOf(issueType: unknown): IpoBoard | null {
  if (issueType === "regular") return "mainboard";
  if (issueType === "sme") return "sme";
  return null;
}

function httpsUrl(value: unknown): string | null {
  const s = str(value);
  return s && /^https:\/\//i.test(s) ? s : null;
}

/* ------------------------------------------------------------ list */

/** One list item, or null when it lacks an id, a name or a known issue type. */
export function parseUpstoxIpo(raw: unknown): UpstoxIpo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const name = str(r.name);
  const board = boardOf(r.issue_type);
  if (!id || !name || !board) return null;
  return {
    id,
    symbol: str(r.symbol),
    name,
    isin: str(r.isin),
    board,
    providerStatus: str(r.status),
    industry: str(r.industry),
    issueSizeCr: positiveNumber(r.issue_size),
    priceBand: parsePriceBand(r.minimum_price, r.maximum_price),
    openDate: parseIsoDate(r.bidding_start_date),
    closeDate: parseIsoDate(r.bidding_end_date),
    totalSubscription: parseSubscription(r.total_subscription),
  };
}

/** GET /v2/ipos → items and paging; null unless it is a success response with a data array. */
export function parseUpstoxIpoList(body: unknown): { items: UpstoxIpo[]; page: UpstoxPage | null } | null {
  const b = body as { status?: unknown; data?: unknown; meta_data?: { page?: { page_number?: unknown; total_pages?: unknown } } } | null;
  if (!b || b.status !== "success" || !Array.isArray(b.data)) return null;
  const items = b.data.map(parseUpstoxIpo).filter((x): x is UpstoxIpo => x !== null);
  const pageNumber = positiveInt(b.meta_data?.page?.page_number);
  const totalPages = positiveInt(b.meta_data?.page?.total_pages);
  return { items, page: pageNumber !== null && totalPages !== null ? { pageNumber, totalPages } : null };
}

/* ------------------------------------------------------------ details */

/** GET /v2/ipos/{id} → details; null unless it is a success response with a valid item. */
export function parseUpstoxIpoDetail(body: unknown): UpstoxIpoDetail | null {
  const b = body as { status?: unknown; data?: unknown } | null;
  if (!b || b.status !== "success") return null;
  const base = parseUpstoxIpo(b.data);
  if (!base) return null;
  const r = b.data as Record<string, unknown>;
  const t = (r.timeline && typeof r.timeline === "object" ? r.timeline : {}) as Record<string, unknown>;
  return {
    ...base,
    // The timeline repeats the bidding window; fall back to it when the top-level dates are missing.
    openDate: base.openDate ?? parseIsoDate(t.application_start_date),
    closeDate: base.closeDate ?? parseIsoDate(t.application_end_date),
    dailyStartTime: parseClock(r.daily_start_time),
    dailyEndTime: parseClock(r.daily_end_time),
    faceValue: positiveNumber(r.face_value),
    lotSize: positiveInt(r.lot_size),
    minimumQuantity: positiveInt(r.minimum_quantity),
    cutOffPrice: positiveNumber(r.cut_off_price),
    listingPrice: positiveNumber(r.listing_price),
    listingExchanges: (str(r.listing_exchange) ?? "")
      .split(",")
      .map((x) => x.trim().toUpperCase())
      .filter((x) => x === "NSE" || x === "BSE"),
    rhpUrl: httpsUrl(r.rhp_url),
    drhpUrl: httpsUrl(r.drhp_url),
    timeline: {
      allotmentDate: parseIsoDate(t.allotment_date),
      refundDate: parseIsoDate(t.refund_initiation_date),
      listingDate: parseIsoDate(t.listing_date),
      mandateEndDate: parseIsoDate(t.mandate_end_date),
    },
  };
}
