import { getBond, type BondLookup } from "../bonds/catalog";
import type { Bond } from "../bonds/bonds";
import { getCommunityDirectory, type Community, type CommunityDirectory } from "./communities";

/**
 * A bond's community: the stable record posts point at when they @mention
 * the bond. Created on first mention, and only after the ISIN has been found
 * in the exchange listings — a client can't create one for a made-up ISIN,
 * and nothing the client says about the bond (issuer, coupon, maturity) is
 * used.
 */

export type BondResolveResult =
  | { ok: true; community: Community; bond: Bond }
  | { ok: false; status: number; error: string; code?: string };

export interface BondResolver {
  /** Verify the bond with the exchange listing, then return (or create) its community. */
  forBond(isin: string): Promise<BondResolveResult>;
  /** The bond's community if anyone has mentioned it yet. Never creates one. */
  findBond(isin: string): Promise<Community | null>;
}

const CHECK_VIOLATION = "23514";

export function bondResolver(directory: CommunityDirectory, lookup: (isin: string) => Promise<BondLookup> = (isin) => getBond(isin)): BondResolver {
  return {
    async forBond(isin) {
      const found = await lookup(isin);
      if (!found.ok) {
        if (found.code === "not_found") return { ok: false, status: 422, error: "That bond isn't listed on NSE or BSE.", code: "MENTION_UNKNOWN" };
        if (found.code === "not_configured") return { ok: false, status: 503, error: "Bond tagging isn't switched on yet.", code: "NOT_CONFIGURED" };
        return { ok: false, status: 503, error: "Bonds can't be checked right now. Try again shortly.", code: "MENTION_UNAVAILABLE" };
      }
      try {
        const community = await directory.ensureBond({ isin, name: found.bond.name });
        return { ok: true, community, bond: found.bond };
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        // Before the bond_communities migration the type check refuses 'bond'.
        if (code === CHECK_VIOLATION || code === "NOT_CONFIGURED") {
          return { ok: false, status: 503, error: "Bond tagging isn't switched on yet.", code: "NOT_CONFIGURED" };
        }
        if (code === "CONFLICT") return { ok: false, status: 422, error: "That ISIN isn't a bond's.", code: "MENTION_UNKNOWN" };
        throw error;
      }
    },
    async findBond(isin) {
      const community = await directory.byIsin(isin);
      return community?.type === "bond" ? community : null;
    },
  };
}

export function getBondResolver(): BondResolver | null {
  const directory = getCommunityDirectory();
  return directory ? bondResolver(directory) : null;
}
