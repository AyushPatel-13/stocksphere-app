import { BOND_ISIN, bondPath, isBondIsin, type Bond, type BondCategory } from "../bonds/bonds";
import type { InstrumentType, SearchResult } from "../search/types";
import { isValidSymbol } from "../validation/symbol";
import type { BondResolveResult } from "./bondCommunity";
import { isIpoId } from "./paths";
import type { ResolveResult } from "./ipoCommunity";

/**
 * Structured @mentions of instruments, IPOs and bonds (supabase/migrations/
 * 20261026000100_post_mentions.sql, 20261027000100_bond_communities.sql).
 *
 * The composer sends what the member picked from the @ autocomplete as
 * { kind, id | ipoId | isin, text } — `text` being the readable "@SBIN" it inserted.
 * The server never trusts names, symbols or statuses from the client: it
 * re-resolves every pick against real records (the shared instrument search,
 * the Upstox-verified IPO community, the bond's exchange listing by ISIN),
 * finds each mention's text in the final
 * body, and stores identity + position + a display snapshot.
 *
 * Nothing here reads post text to guess an entity: a post names a stock or an
 * IPO only when the member picked it.
 */

export const MAX_MENTIONS = 5;
export const MAX_MENTION_TEXT = 80;

/** Instrument types whose pages already have a discussion board (stock pages, /asset/[type]). */
export const MENTIONABLE_TYPES: readonly InstrumentType[] = ["stock", "etf", "index", "crypto"];

export type InstrumentMention = {
  kind: "instrument";
  /** The shared search's stable id ("India:SBIN", "index:NIFTY"). */
  id: string;
  type: InstrumentType;
  /** The board symbol: the one its page's discussion is filed under. */
  symbol: string;
  exchange: string;
  name: string;
  href: string;
  start: number;
  end: number;
};

export type IpoMention = {
  kind: "ipo";
  communityId: string;
  ipoId: string;
  name: string;
  start: number;
  end: number;
};

/**
 * A bond, by ISIN — never by the issuer's ticker. The other fields are the
 * verified exchange record at the time of writing (see lib/bonds/bonds.ts),
 * null where the record doesn't state them.
 */
export type BondMention = {
  kind: "bond";
  communityId: string;
  isin: string;
  /** The exchange trading symbol the mention text shows ("718GS2033"). */
  symbol: string;
  name: string;
  issuer: string | null;
  category: BondCategory;
  coupon: number | null;
  maturity: string | null;
  start: number;
  end: number;
};

export type StoredMention = InstrumentMention | IpoMention | BondMention;

export type MentionInput =
  | { kind: "instrument"; id: string; type: InstrumentType; text: string }
  | { kind: "ipo"; ipoId: string; text: string }
  | { kind: "bond"; isin: string; text: string };

const INSTRUMENT_ID = /^[A-Za-z]{2,10}:[A-Za-z0-9][A-Za-z0-9.&^-]{0,24}$/;

type Fail = { ok: false; status: number; error: string; code?: string };

/** The request's `mentions`, shape-checked. Anything malformed is refused, not ignored. */
export function parseMentionInputs(raw: unknown): { ok: true; inputs: MentionInput[] } | Fail {
  if (raw === undefined || raw === null) return { ok: true, inputs: [] };
  if (!Array.isArray(raw)) return { ok: false, status: 400, error: "Invalid mentions." };
  if (raw.length > MAX_MENTIONS) return { ok: false, status: 422, error: `Mention at most ${MAX_MENTIONS} stocks, IPOs or bonds in a post.`, code: "RULES" };

  const inputs: MentionInput[] = [];
  for (const item of raw) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text : "";
    if (!text.startsWith("@") || text.length < 2 || text.length > MAX_MENTION_TEXT || /[\r\n]/.test(text)) {
      return { ok: false, status: 400, error: "Invalid mention." };
    }
    if (r.kind === "instrument") {
      if (typeof r.id !== "string" || !INSTRUMENT_ID.test(r.id)) return { ok: false, status: 400, error: "Invalid mention." };
      if (typeof r.type !== "string" || !(MENTIONABLE_TYPES as readonly string[]).includes(r.type)) {
        return { ok: false, status: 400, error: "That kind of instrument can't be mentioned." };
      }
      inputs.push({ kind: "instrument", id: r.id, type: r.type as InstrumentType, text });
    } else if (r.kind === "ipo") {
      if (!isIpoId(r.ipoId)) return { ok: false, status: 400, error: "Invalid mention." };
      inputs.push({ kind: "ipo", ipoId: r.ipoId, text });
    } else if (r.kind === "bond") {
      if (!isBondIsin(r.isin)) return { ok: false, status: 400, error: "Invalid mention." };
      inputs.push({ kind: "bond", isin: r.isin, text });
    } else {
      return { ok: false, status: 400, error: "Invalid mention." };
    }
  }
  return { ok: true, inputs };
}

/** A mention starts where an @ can start a mention: not inside a word or an email address. */
export function atBoundary(body: string, index: number): boolean {
  return index === 0 || !/[A-Za-z0-9_.@]/.test(body[index - 1]);
}

/**
 * Where each mention's text sits in the final body, in order. Null when one
 * is missing (the member edited it away), so the caller can say so.
 */
export function locateMentions(body: string, inputs: MentionInput[]): { start: number; end: number }[] | null {
  const spans: { start: number; end: number }[] = [];
  let from = 0;
  for (const input of inputs) {
    let index = body.indexOf(input.text, from);
    while (index !== -1 && !atBoundary(body, index)) index = body.indexOf(input.text, index + 1);
    if (index === -1) return null;
    spans.push({ start: index, end: index + input.text.length });
    from = index + input.text.length;
  }
  return spans;
}

/** "/stock/SBIN" → "SBIN"; "/asset/index/NIFTY" → "NIFTY"; anything else → null. */
export function boardSymbolOf(href: string): string | null {
  const match = /^\/(?:stock|asset\/(?:etf|index|crypto))\/([^/?#]+)$/.exec(href);
  if (!match) return null;
  let symbol: string;
  try {
    symbol = decodeURIComponent(match[1]).toUpperCase();
  } catch {
    return null;
  }
  return isValidSymbol(symbol) ? symbol : null;
}

export interface MentionResolver {
  /** The shared search's record for this id, or why there isn't one. */
  instrument(id: string, type: InstrumentType): Promise<{ ok: true; result: SearchResult } | Fail>;
  /** The IPO's community (created on first use, verified with Upstox). */
  ipo(ipoId: string): Promise<ResolveResult>;
  /** The bond's community and verified record (created on first use, by ISIN). */
  bond(isin: string): Promise<BondResolveResult>;
}

export type ResolvedMentions = {
  mentions: StoredMention[];
  /** Board symbols the instrument mentions add to posts.symbols. */
  symbols: string[];
  /** IPO and bond communities mentioned (posts.mention_community_ids). */
  communityIds: string[];
};

export async function resolveMentions(
  inputs: MentionInput[],
  body: string,
  resolver: MentionResolver | null
): Promise<({ ok: true } & ResolvedMentions) | Fail> {
  if (inputs.length === 0) return { ok: true, mentions: [], symbols: [], communityIds: [] };
  if (!resolver) return { ok: false, status: 503, error: "Mentions aren't switched on yet.", code: "NOT_CONFIGURED" };

  const spans = locateMentions(body, inputs);
  if (!spans) {
    return { ok: false, status: 422, error: "A mention was changed after you picked it. Pick it again from the @ list.", code: "MENTION_TEXT" };
  }

  // Each distinct entity is resolved once, all in parallel.
  const instrumentKeys = [...new Set(inputs.filter((i) => i.kind === "instrument").map((i) => `${i.type}|${i.id}`))];
  const ipoIds = [...new Set(inputs.filter((i) => i.kind === "ipo").map((i) => i.ipoId))];
  const isins = [...new Set(inputs.filter((i) => i.kind === "bond").map((i) => i.isin))];
  const [instruments, ipos, bonds] = await Promise.all([
    Promise.all(instrumentKeys.map((key) => resolver.instrument(key.split("|")[1], key.split("|")[0] as InstrumentType))),
    Promise.all(ipoIds.map((id) => resolver.ipo(id))),
    Promise.all(isins.map((isin) => resolver.bond(isin))),
  ]);

  const byInstrument = new Map<string, SearchResult>();
  for (let i = 0; i < instrumentKeys.length; i++) {
    const found = instruments[i];
    if (!found.ok) return found;
    byInstrument.set(instrumentKeys[i], found.result);
  }
  const byIpo = new Map<string, { communityId: string; name: string }>();
  for (let i = 0; i < ipoIds.length; i++) {
    const found = ipos[i];
    if (!found.ok) return { ok: false, status: found.status, error: found.error, code: found.code };
    byIpo.set(ipoIds[i], { communityId: found.community.id, name: found.community.name });
  }
  const byIsin = new Map<string, { communityId: string; bond: Bond }>();
  for (let i = 0; i < isins.length; i++) {
    const found = bonds[i];
    if (!found.ok) return { ok: false, status: found.status, error: found.error, code: found.code };
    byIsin.set(isins[i], { communityId: found.community.id, bond: found.bond });
  }

  const mentions: StoredMention[] = [];
  const symbols: string[] = [];
  const communityIds: string[] = [];

  inputs.forEach((input, index) => {
    const { start, end } = spans[index];
    if (input.kind === "instrument") {
      const result = byInstrument.get(`${input.type}|${input.id}`)!;
      const symbol = boardSymbolOf(result.href) ?? result.symbol;
      mentions.push({ kind: "instrument", id: result.id, type: result.type, symbol, exchange: result.exchange, name: result.name, href: result.href, start, end });
      if (!symbols.includes(symbol)) symbols.push(symbol);
    } else if (input.kind === "ipo") {
      const ipo = byIpo.get(input.ipoId)!;
      mentions.push({ kind: "ipo", communityId: ipo.communityId, ipoId: input.ipoId, name: ipo.name, start, end });
      if (!communityIds.includes(ipo.communityId)) communityIds.push(ipo.communityId);
    } else {
      const { communityId, bond } = byIsin.get(input.isin)!;
      mentions.push({
        kind: "bond",
        communityId,
        isin: bond.isin,
        symbol: bond.listings[0]?.symbol ?? bond.isin,
        name: bond.name,
        issuer: bond.issuer,
        category: bond.category,
        coupon: bond.coupon,
        maturity: bond.maturity,
        start,
        end,
      });
      if (!communityIds.includes(communityId)) communityIds.push(communityId);
    }
  });

  return { ok: true, mentions, symbols, communityIds };
}

/* ------------------------------------------------------------ reading */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOND_CATEGORIES: readonly BondCategory[] = ["government", "state", "tbill", "sgb", "corporate"];
const str = (v: unknown) => (typeof v === "string" ? v : null);

/**
 * Stored mentions as the UI may use them. Anything that doesn't fit the body
 * or the shape is dropped (the post then renders as plain text there), so a
 * bad row can never produce a wrong link. hrefs are app routes only.
 */
export function readMentions(raw: unknown, body: string): StoredMention[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredMention[] = [];
  let last = 0;
  for (const item of raw.slice(0, MAX_MENTIONS)) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const start = typeof r.start === "number" ? r.start : -1;
    const end = typeof r.end === "number" ? r.end : -1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < last || end <= start || end > body.length || body[start] !== "@") continue;
    if (r.kind === "instrument") {
      const href = str(r.href);
      const symbol = str(r.symbol);
      if (!href || !boardSymbolOf(href) || !symbol || !str(r.id)) continue;
      out.push({
        kind: "instrument",
        id: str(r.id)!,
        type: (MENTIONABLE_TYPES as readonly string[]).includes(String(r.type)) ? (r.type as InstrumentType) : "stock",
        symbol,
        exchange: str(r.exchange) ?? "",
        name: str(r.name) ?? symbol,
        href,
        start,
        end,
      });
    } else if (r.kind === "ipo") {
      const communityId = str(r.communityId);
      const ipoId = str(r.ipoId);
      if (!communityId || !UUID.test(communityId) || !isIpoId(ipoId)) continue;
      out.push({ kind: "ipo", communityId, ipoId: ipoId!, name: str(r.name) ?? "IPO", start, end });
    } else if (r.kind === "bond") {
      const communityId = str(r.communityId);
      const isin = str(r.isin);
      const category = BOND_CATEGORIES.find((c) => c === r.category);
      if (!communityId || !UUID.test(communityId) || !isin || !BOND_ISIN.test(isin) || !category) continue;
      const maturity = str(r.maturity);
      out.push({
        kind: "bond",
        communityId,
        isin,
        symbol: str(r.symbol) ?? isin,
        name: str(r.name) ?? isin,
        issuer: str(r.issuer),
        category,
        coupon: typeof r.coupon === "number" && Number.isFinite(r.coupon) ? r.coupon : null,
        maturity: maturity && /^\d{4}(?:-\d{2}-\d{2})?$/.test(maturity) ? maturity : null,
        start,
        end,
      });
    } else {
      continue;
    }
    last = end;
  }
  return out;
}

/** Where a stored mention links: the instrument's page, the IPO's community, or the bond's page. */
export function mentionPath(mention: StoredMention, ipoPath: (ipoId: string) => string): string {
  if (mention.kind === "instrument") return mention.href;
  if (mention.kind === "bond") return bondPath(mention.isin);
  return ipoPath(mention.ipoId);
}
