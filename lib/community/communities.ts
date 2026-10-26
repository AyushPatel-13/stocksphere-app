import type { SupabaseClient } from "@supabase/supabase-js";

import { isIndianEquitySymbol } from "../data/instruments/india";
import { getAdminClient, getPublicClient } from "../supabase/server";
import { isValidSymbol } from "../validation/symbol";

/**
 * Communities: one stable identity per company (supabase/migrations/
 * 20261024000200_communities.sql). An IPO's community is created the first
 * time someone posts in it; when the issue lists, the listing service
 * (lib/community/listing.ts) gives the same row its verified exchange and
 * symbol. Posts point at the row, so nothing is copied.
 *
 * Stock boards keep reading posts by symbol. When a symbol belongs to a linked
 * community, the board also reads that community's posts — the same records
 * the IPO page shows.
 *
 * A bond is a community too (supabase/migrations/20261027000100_bond_
 * communities.sql): type 'bond', keyed by the bond's own ISIN, created the
 * first time someone @mentions it. It never gets a ticker and never changes
 * type; its page (/bonds/<ISIN>) reads the posts that mention it.
 */

export type Exchange = "NSE" | "BSE";

export type Community = {
  id: string;
  type: "ipo" | "stock" | "bond";
  name: string;
  isin: string | null;
  ipoId: string | null;
  board: "mainboard" | "sme" | null;
  exchange: Exchange | null;
  symbol: string | null;
  listedAt: string | null;
};

export type NewIpoCommunity = {
  ipoId: string;
  isin: string | null;
  name: string;
  board: "mainboard" | "sme" | null;
};

export interface CommunityDirectory {
  byIpoId(ipoId: string): Promise<Community | null>;
  byIsin(isin: string): Promise<Community | null>;
  byListing(exchange: Exchange, symbol: string): Promise<Community | null>;
  /** Insert or return the existing row; safe under concurrent first posts (unique keys). */
  ensureIpo(input: NewIpoCommunity): Promise<Community>;
  /** The bond's community, created on first use. The ISIN must already be verified. */
  ensureBond(input: { isin: string; name: string }): Promise<Community>;
}

export { IPO_ID_PATTERN, ipoCommunityPath, isIpoId } from "./paths";

export const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/* ------------------------------------------------------------ symbols */

/**
 * A stock board's symbol → the listing it names. "XYZ", "XYZ.NS" → NSE XYZ;
 * "XYZ.BSE", "XYZ.BO" → BSE XYZ. Null for anything that can't be one.
 */
export function listingOfBoard(boardSymbol: string): { exchange: Exchange; symbol: string } | null {
  const upper = boardSymbol.trim().toUpperCase();
  const bse = upper.match(/^(.+)\.(BSE|BO)$/);
  const bare = bse ? bse[1] : upper.replace(/\.NS$/, "");
  if (!bare || !isValidSymbol(bare) || bare.includes(".")) return null;
  return { exchange: bse ? "BSE" : "NSE", symbol: bare };
}

/** Every board spelling of a listing, so posts tagged any of these belong to it. */
export function boardSymbols(exchange: Exchange, symbol: string): string[] {
  return exchange === "NSE" ? [symbol, `${symbol}.NS`] : [`${symbol}.BSE`, `${symbol}.BO`];
}

/**
 * The symbol a linked community's stock page uses. A new NSE listing isn't in
 * the bundled equity list yet, so it carries ".NS" to be routed as Indian.
 */
export function stockBoardSymbol(exchange: Exchange, symbol: string): string {
  if (exchange === "BSE") return `${symbol}.BSE`;
  return isIndianEquitySymbol(symbol) ? symbol : `${symbol}.NS`;
}

export function stockPath(community: Community): string | null {
  return community.type === "stock" && community.exchange && community.symbol
    ? `/stock/${encodeURIComponent(stockBoardSymbol(community.exchange, community.symbol))}`
    : null;
}

/** Which posts a community's feed holds: its own, plus (once listed) its ticker's. */
export function communityScope(community: Community): { communityId: string; anySymbols: string[] } {
  return {
    communityId: community.id,
    anySymbols: community.type === "stock" && community.exchange && community.symbol ? boardSymbols(community.exchange, community.symbol) : [],
  };
}

/** Missing table or column: the migration hasn't been applied. */
export function isNotMigrated(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "PGRST205" || code === "42703" || code === "PGRST204";
}

/* ------------------------------------------------------------ Supabase */

type CommunityRow = {
  id: string;
  type: "ipo" | "stock" | "bond";
  name: string;
  isin: string | null;
  upstox_ipo_id: string | null;
  board: "mainboard" | "sme" | null;
  exchange: Exchange | null;
  symbol: string | null;
  listed_at: string | null;
};

export const COMMUNITY_COLUMNS = "id, type, name, isin, upstox_ipo_id, board, exchange, symbol, listed_at";

export function toCommunity(row: CommunityRow): Community {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    isin: row.isin,
    ipoId: row.upstox_ipo_id,
    board: row.board,
    exchange: row.exchange,
    symbol: row.symbol,
    listedAt: row.listed_at,
  };
}

const UNIQUE_VIOLATION = "23505";

export function supabaseDirectory(reader: SupabaseClient, admin: SupabaseClient | null): CommunityDirectory {
  async function one(column: string, value: string | [Exchange, string]): Promise<Community | null> {
    let query = reader.from("communities").select(COMMUNITY_COLUMNS);
    query = Array.isArray(value) ? query.eq("exchange", value[0]).eq("symbol", value[1]) : query.eq(column, value);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data ? toCommunity(data as CommunityRow) : null;
  }

  const directory: CommunityDirectory = {
    byIpoId: (ipoId) => one("upstox_ipo_id", ipoId),
    byIsin: (isin) => one("isin", isin),
    byListing: (exchange, symbol) => one("listing", [exchange, symbol]),

    async ensureIpo(input) {
      if (!admin) throw Object.assign(new Error("Service role not configured"), { code: "NOT_CONFIGURED" });

      const existing = (await directory.byIpoId(input.ipoId)) ?? (input.isin ? await directory.byIsin(input.isin) : null);
      // An equity ISIN can't be a bond's, but never hand a bond community to an IPO.
      if (existing?.type === "bond") throw Object.assign(new Error("ISIN belongs to a bond"), { code: "CONFLICT" });
      if (existing) {
        // Upstox publishes an upcoming issue's ISIN late: fill it in once.
        if (!existing.isin && input.isin && existing.ipoId === input.ipoId) {
          const { error } = await admin.from("communities").update({ isin: input.isin }).eq("id", existing.id).is("isin", null);
          if (error && error.code !== UNIQUE_VIOLATION) throw error;
          if (!error) return { ...existing, isin: input.isin };
        }
        return existing;
      }

      const { data, error } = await admin
        .from("communities")
        .insert({ type: "ipo", name: input.name, isin: input.isin, upstox_ipo_id: input.ipoId, board: input.board })
        .select(COMMUNITY_COLUMNS)
        .single();
      if (!error) return toCommunity(data as CommunityRow);
      if (error.code !== UNIQUE_VIOLATION) throw error;

      // Someone else created it a moment ago: use theirs.
      const raced = (await directory.byIpoId(input.ipoId)) ?? (input.isin ? await directory.byIsin(input.isin) : null);
      if (!raced) throw error;
      return raced;
    },

    async ensureBond({ isin, name }) {
      if (!admin) throw Object.assign(new Error("Service role not configured"), { code: "NOT_CONFIGURED" });
      const existing = await directory.byIsin(isin);
      if (existing) {
        if (existing.type !== "bond") throw Object.assign(new Error("ISIN belongs to another community"), { code: "CONFLICT" });
        return existing;
      }
      const { data, error } = await admin.from("communities").insert({ type: "bond", name, isin }).select(COMMUNITY_COLUMNS).single();
      if (!error) return toCommunity(data as CommunityRow);
      if (error.code !== UNIQUE_VIOLATION) throw error;
      const raced = await directory.byIsin(isin);
      if (!raced || raced.type !== "bond") throw error;
      return raced;
    },
  };

  return directory;
}

export function getCommunityDirectory(): CommunityDirectory | null {
  const reader = getPublicClient();
  return reader ? supabaseDirectory(reader, getAdminClient()) : null;
}
