import { getUpstoxIpoDetail, type UpstoxErrorCode, type UpstoxResult } from "../apis/upstox";
import { listingStateOf, UPSTOX_ERROR_MESSAGES } from "../services/ipo";
import { indiaDateKey, ipoSection, type IpoSection } from "../services/ipoMetrics";
import { parseUpstoxIpoDetail, type PriceBand, type UpstoxIpoDetail } from "../services/ipoParse";
import {
  boardSymbols,
  getCommunityDirectory,
  isIpoId,
  isNotMigrated,
  listingOfBoard,
  stockPath,
  type Community,
  type CommunityDirectory,
} from "./communities";

/**
 * IPO communities: what an IPO's community page shows, and how a post finds
 * (or creates) its community.
 *
 * IPO facts come only from Upstox's IPO details endpoint, the same source as
 * the IPO page. Nothing is estimated; there is no GMP here (none is configured
 * — see GMP_UNAVAILABLE_REASON in lib/services/ipo.ts).
 */

export type IpoSummary = {
  id: string;
  name: string;
  isin: string | null;
  board: "mainboard" | "sme";
  industry: string | null;
  section: IpoSection | null;
  listingState: "listed" | "awaiting" | null;
  openDate: string | null;
  closeDate: string | null;
  priceBand: PriceBand | null;
  cutOffPrice: number | null;
  lotSize: number | null;
  issueSizeCr: number | null;
  subscription: number | null;
  listingDate: string | null;
  listingExchanges: string[];
  listingPrice: number | null;
  rhpUrl: string | null;
  fetchedAt: string;
};

export type IpoLookup = { ok: true; ipo: IpoSummary; detail: UpstoxIpoDetail } | { ok: false; code: UpstoxErrorCode; message: string };

export type IpoDetailFetch = (id: string) => Promise<UpstoxResult>;

export function summarise(detail: UpstoxIpoDetail, nowMs: number): IpoSummary {
  const today = indiaDateKey(nowMs);
  const section = ipoSection(detail, today).section;
  return {
    id: detail.id,
    name: detail.name,
    isin: detail.isin,
    board: detail.board,
    industry: detail.industry,
    section,
    listingState:
      section === "closed" ? listingStateOf(detail.listingPrice, detail.timeline.listingDate, detail.providerStatus, true, today) : null,
    openDate: detail.openDate,
    closeDate: detail.closeDate,
    priceBand: detail.priceBand,
    cutOffPrice: detail.cutOffPrice,
    lotSize: detail.lotSize,
    issueSizeCr: detail.issueSizeCr,
    subscription: section === "upcoming" ? null : detail.totalSubscription,
    listingDate: detail.timeline.listingDate,
    listingExchanges: detail.listingExchanges,
    listingPrice: detail.listingPrice,
    rhpUrl: detail.rhpUrl,
    fetchedAt: new Date(nowMs).toISOString(),
  };
}

const LOOKUP_TTL_MS = 2 * 60_000;
const lookupCache = new Map<string, { at: number; value: IpoLookup & { ok: true } }>();

/** Test hook. */
export function clearIpoLookupCache() {
  lookupCache.clear();
}

export async function lookupIpo(
  ipoId: string,
  fetchDetail: IpoDetailFetch = getUpstoxIpoDetail,
  now: () => number = Date.now
): Promise<IpoLookup> {
  const hit = lookupCache.get(ipoId);
  if (hit && now() - hit.at < LOOKUP_TTL_MS) return hit.value;

  const result = await fetchDetail(ipoId);
  if (!result.ok) return { ok: false, code: result.code, message: UPSTOX_ERROR_MESSAGES[result.code] };
  const detail = parseUpstoxIpoDetail(result.body);
  // An id that comes back as a different issue is not this IPO.
  if (!detail || detail.id !== ipoId) return { ok: false, code: "not_found", message: UPSTOX_ERROR_MESSAGES.not_found };

  const value = { ok: true as const, ipo: summarise(detail, now()), detail };
  lookupCache.set(ipoId, { at: now(), value });
  return value;
}

/* ------------------------------------------------------------ posting */

export type ResolveResult = { ok: true; community: Community } | { ok: false; status: number; error: string; code?: string };

/** How createPost finds the community a post belongs in. */
export interface CommunityResolver {
  /** The IPO's community, created on first use. Verifies the IPO with Upstox before creating. */
  forIpo(ipoId: string): Promise<ResolveResult>;
  /** The linked community whose ticker this stock board shows, if any. Never throws. */
  forBoard(boardSymbol: string): Promise<Community | null>;
  /** An IPO's existing community, without creating one. Null before the migration. */
  findIpo(ipoId: string): Promise<Community | null>;
}

const NOT_SWITCHED_ON = { ok: false as const, status: 503, error: "IPO communities aren't switched on yet.", code: "NOT_CONFIGURED" };

export function communityResolver(
  directory: CommunityDirectory,
  lookup: (ipoId: string) => Promise<IpoLookup> = (id) => lookupIpo(id)
): CommunityResolver {
  return {
    async forIpo(ipoId) {
      if (!isIpoId(ipoId)) return { ok: false, status: 400, error: "Unknown IPO." };
      try {
        const existing = await directory.byIpoId(ipoId);
        if (existing) return { ok: true, community: existing };

        const found = await lookup(ipoId);
        if (!found.ok) {
          return found.code === "not_found"
            ? { ok: false, status: 404, error: "Upstox has no IPO with that id." }
            : { ok: false, status: 503, error: "IPO details can't be checked right now, so this community can't be opened yet. Try again later.", code: "IPO_UNAVAILABLE" };
        }

        const { detail } = found;
        const community = await directory.ensureIpo({ ipoId, isin: detail.isin, name: detail.name, board: detail.board });
        return { ok: true, community };
      } catch (error) {
        if (isNotMigrated(error) || (error as { code?: string })?.code === "NOT_CONFIGURED") return NOT_SWITCHED_ON;
        throw error;
      }
    },

    async forBoard(boardSymbol) {
      const listing = listingOfBoard(boardSymbol);
      if (!listing) return null;
      try {
        const community = await directory.byListing(listing.exchange, listing.symbol);
        return community?.type === "stock" ? community : null;
      } catch (error) {
        // Before the migration, boards work exactly as they did.
        if (!isNotMigrated(error)) console.error("Community lookup error:", (error as Error)?.message ?? error);
        return null;
      }
    },

    async findIpo(ipoId) {
      if (!isIpoId(ipoId)) return null;
      try {
        return await directory.byIpoId(ipoId);
      } catch (error) {
        if (isNotMigrated(error)) return null;
        throw error;
      }
    },
  };
}

export function getCommunityResolver(): CommunityResolver | null {
  const directory = getCommunityDirectory();
  return directory ? communityResolver(directory) : null;
}

/* ------------------------------------------------------------ page */

export type PublicCommunity = {
  id: string;
  type: Community["type"];
  name: string;
  ipoId: string | null;
  isin: string | null;
  board: "mainboard" | "sme" | null;
  exchange: string | null;
  symbol: string | null;
  listedAt: string | null;
  stockPath: string | null;
  boardSymbols: string[];
};

export function publicCommunity(community: Community): PublicCommunity {
  return {
    id: community.id,
    type: community.type,
    name: community.name,
    ipoId: community.ipoId,
    isin: community.isin,
    board: community.board,
    exchange: community.exchange,
    symbol: community.symbol,
    listedAt: community.listedAt,
    stockPath: stockPath(community),
    boardSymbols: community.exchange && community.symbol ? boardSymbols(community.exchange, community.symbol) : [],
  };
}

export type IpoCommunityPage = {
  ipoId: string;
  ipo: IpoSummary | null;
  /** Why the IPO's details are missing (Upstox unavailable, unknown id). */
  ipoError: { code: UpstoxErrorCode; message: string } | null;
  community: PublicCommunity | null;
  /** "not_configured" before the migration is applied. */
  communityStatus: "ok" | "not_configured" | "unavailable";
};

/**
 * Everything the IPO community header needs. Read-only: the community row is
 * created by the first post, not by visiting the page. After the IPO leaves
 * Upstox's lists the stored community still answers, so the URL keeps working.
 */
export async function getIpoCommunityPage(
  ipoId: string,
  directory: CommunityDirectory | null,
  lookup: (ipoId: string) => Promise<IpoLookup> = (id) => lookupIpo(id)
): Promise<IpoCommunityPage> {
  const found = await lookup(ipoId);
  const ipo = found.ok ? found.ipo : null;
  const ipoError = found.ok ? null : { code: found.code, message: found.message };

  if (!directory) return { ipoId, ipo, ipoError, community: null, communityStatus: "not_configured" };

  try {
    const community = (await directory.byIpoId(ipoId)) ?? (ipo?.isin ? await directory.byIsin(ipo.isin) : null);
    return { ipoId, ipo, ipoError, community: community ? publicCommunity(community) : null, communityStatus: "ok" };
  } catch (error) {
    if (isNotMigrated(error)) return { ipoId, ipo, ipoError, community: null, communityStatus: "not_configured" };
    console.error("Community lookup error:", (error as Error)?.message ?? error);
    return { ipoId, ipo, ipoError, community: null, communityStatus: "unavailable" };
  }
}
