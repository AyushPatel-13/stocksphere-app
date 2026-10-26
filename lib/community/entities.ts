import type { SupabaseClient } from "@supabase/supabase-js";

import { searchInstruments } from "../search/instruments";
import { assetLabel, type InstrumentType, type SearchResponse, type SearchResult } from "../search/types";
import { getIpoBoard, type IpoBoardResult } from "../services/ipo";
import { getPublicClient } from "../supabase/server";
import { COMMUNITY_COLUMNS, stockPath, toCommunity, type Community } from "./communities";
import { getCommunityResolver, type CommunityResolver } from "./ipoCommunity";
import { MENTIONABLE_TYPES, type MentionResolver } from "./mentions";
import { ipoCommunityPath } from "./paths";
import type { IpoStatus, PostContext, PostView } from "./types";

/**
 * The @ autocomplete's sources, the server-side check of every pick, and the
 * "what this post is about" context shown on post cards.
 *
 *   Instruments  the shared instrument search (lib/search), limited to types
 *                whose pages have a discussion board
 *   IPOs         the IPO catalogue (Upstox, lib/services/ipo.ts): open and
 *                upcoming issues
 */

/* ------------------------------------------------------------ autocomplete */

export type EntitySuggestion =
  | {
      kind: "instrument";
      id: string;
      type: InstrumentType;
      symbol: string;
      name: string;
      exchange: string;
      /** "Indian stock", "Index"… */
      label: string;
      href: string;
    }
  | {
      kind: "ipo";
      ipoId: string;
      name: string;
      status: "open" | "upcoming";
      board: "mainboard" | "sme";
      href: string;
    };

export type EntitySearch = {
  query: string;
  results: EntitySuggestion[];
  /** A source failed or timed out; results may be incomplete. */
  partial: boolean;
};

export const ENTITY_QUERY_MAX = 40;
export const MAX_INSTRUMENT_SUGGESTIONS = 6;
export const MAX_IPO_SUGGESTIONS = 4;
const IPO_TIMEOUT_MS = 3_000;

export interface EntityDeps {
  search: (query: string, limit: number, filters: { types: InstrumentType[] }) => Promise<SearchResponse>;
  ipoBoard: () => Promise<IpoBoardResult>;
}

export const defaultEntityDeps: EntityDeps = {
  search: (query, limit, filters) => searchInstruments(query, limit, filters),
  ipoBoard: () => getIpoBoard(),
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise.catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/** Every word of the query starts a word of the name (or the symbol starts with it). */
export function ipoMatches(name: string, symbol: string | null, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return false;
  if (symbol && symbol.toLowerCase().startsWith(q)) return true;
  const words = name.toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean);
  return q.split(/\s+/).every((part) => words.some((word) => word.startsWith(part)));
}

export async function searchEntities(rawQuery: string, deps: EntityDeps = defaultEntityDeps): Promise<EntitySearch> {
  const query = rawQuery.trim().replace(/\s+/g, " ").slice(0, ENTITY_QUERY_MAX);

  const [instruments, board] = await Promise.all([
    deps.search(query, MAX_INSTRUMENT_SUGGESTIONS, { types: [...MENTIONABLE_TYPES] }).catch(() => null),
    withTimeout(deps.ipoBoard(), IPO_TIMEOUT_MS),
  ]);

  const ipos: EntitySuggestion[] =
    board && board.ok
      ? board.data.ipos
          .filter((row) => (row.section === "open" || row.section === "upcoming") && ipoMatches(row.name, row.symbol, query))
          .slice(0, MAX_IPO_SUGGESTIONS)
          .map((row) => ({
            kind: "ipo" as const,
            ipoId: row.id,
            name: row.name,
            status: row.section as "open" | "upcoming",
            board: row.board,
            href: ipoCommunityPath(row.id),
          }))
      : [];

  const stocks: EntitySuggestion[] = (instruments?.results ?? [])
    .filter((r) => (MENTIONABLE_TYPES as readonly string[]).includes(r.type))
    .map((r) => ({ kind: "instrument" as const, id: r.id, type: r.type, symbol: r.symbol, name: r.name, exchange: r.exchange, label: assetLabel(r), href: r.href }));

  return {
    query,
    // Listed instruments first (the shared search's ranking), then IPOs.
    results: [...stocks, ...ipos],
    partial: !instruments || instruments.partial || !board || !board.ok,
  };
}

/* ------------------------------------------------------------ verifying picks */

/**
 * Re-resolves each pick on the server. An instrument must come back from the
 * shared search under the same id; an IPO must be verified with Upstox (the
 * community resolver does that, creating its community on first use).
 */
export function mentionResolver(communities: CommunityResolver | null, deps: Pick<EntityDeps, "search"> = defaultEntityDeps): MentionResolver {
  return {
    async instrument(id, type) {
      const symbol = id.slice(id.indexOf(":") + 1);
      let response: SearchResponse;
      try {
        response = await deps.search(symbol, 15, { types: [type] });
      } catch {
        return { ok: false, status: 503, error: "Mentions can't be checked right now. Try again shortly.", code: "MENTION_UNAVAILABLE" };
      }
      const result: SearchResult | undefined = response.results.find((r) => r.id === id && r.type === type);
      if (result) return { ok: true, result };
      return response.partial
        ? { ok: false, status: 503, error: "Mentions can't be checked right now. Try again shortly.", code: "MENTION_UNAVAILABLE" }
        : { ok: false, status: 422, error: "One of the mentioned instruments wasn't found.", code: "MENTION_UNKNOWN" };
    },
    async ipo(ipoId) {
      if (!communities) return { ok: false, status: 503, error: "IPO communities aren't switched on yet.", code: "NOT_CONFIGURED" };
      return communities.forIpo(ipoId);
    },
  };
}

export function getMentionResolver(): MentionResolver {
  return mentionResolver(getCommunityResolver());
}

/* ------------------------------------------------------------ post context */

export interface ContextDeps {
  /** Communities by id, in one query. */
  communities: (ids: string[]) => Promise<Community[]>;
  ipoBoard: () => Promise<IpoBoardResult>;
}

export function supabaseContextDeps(reader: SupabaseClient): ContextDeps {
  return {
    async communities(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await reader.from("communities").select(COMMUNITY_COLUMNS).in("id", ids);
      if (error) throw error;
      return (data ?? []).map((row) => toCommunity(row as Parameters<typeof toCommunity>[0]));
    },
    ipoBoard: () => getIpoBoard(),
  };
}

export function getContextDeps(): ContextDeps | null {
  const reader = getPublicClient();
  return reader ? supabaseContextDeps(reader) : null;
}

function statusOf(community: Community, board: IpoBoardResult | null): IpoStatus | null {
  if (community.type === "stock") return "listed";
  const row = board?.ok && community.ipoId ? board.data.ipos.find((r) => r.id === community.ipoId) : undefined;
  if (!row) return null;
  if (row.section === "closed") return row.listingState === "listed" ? "listed" : "closed";
  return row.section;
}

/**
 * Adds `context` to each post from its stored relations: the community it was
 * written in and its verified mentions. One communities query and one
 * (cached) IPO board read per page, however many posts — no per-post calls.
 * If either source fails, posts still come back, with less context.
 */
export async function attachContext(posts: PostView[], deps: ContextDeps | null): Promise<PostView[]> {
  if (!deps || posts.length === 0) return posts;

  const ids = new Set<string>();
  for (const post of posts) {
    if (post.communityId) ids.add(post.communityId);
    for (const m of post.mentions ?? []) if (m.kind === "ipo") ids.add(m.communityId);
  }

  let communities = new Map<string, Community>();
  let board: IpoBoardResult | null = null;
  if (ids.size > 0) {
    const [found, ipoBoard] = await Promise.all([
      deps.communities([...ids]).catch(() => [] as Community[]),
      withTimeout(deps.ipoBoard(), IPO_TIMEOUT_MS),
    ]);
    communities = new Map(found.map((c) => [c.id, c]));
    board = ipoBoard;
  }

  const ipoContext = (community: Community, via: "community" | "mention"): PostContext => {
    const path = stockPath(community);
    return {
      kind: "ipo",
      communityId: community.id,
      ipoId: community.ipoId,
      name: community.name,
      status: statusOf(community, board),
      href: community.ipoId ? ipoCommunityPath(community.ipoId) : (path ?? "/ipo"),
      listed: path && community.exchange && community.symbol ? { exchange: community.exchange, symbol: community.symbol, href: path } : null,
      via,
    };
  };

  return posts.map((post) => {
    const context: PostContext[] = [];
    const seen = new Set<string>();
    const home = post.communityId ? communities.get(post.communityId) : undefined;
    if (home) {
      context.push(ipoContext(home, "community"));
      seen.add(home.id);
    }
    for (const m of post.mentions ?? []) {
      if (m.kind === "ipo") {
        const community = communities.get(m.communityId);
        if (community && !seen.has(community.id)) {
          context.push(ipoContext(community, "mention"));
          seen.add(community.id);
        }
      } else if (!seen.has(m.id)) {
        context.push({ kind: "instrument", id: m.id, type: m.type, name: m.name, symbol: m.symbol, exchange: m.exchange, href: m.href, via: "mention" });
        seen.add(m.id);
      }
    }
    return context.length ? { ...post, context } : post;
  });
}
