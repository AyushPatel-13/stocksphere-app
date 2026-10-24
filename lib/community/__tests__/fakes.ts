import type { SupabaseClient } from "@supabase/supabase-js";

import type { Community, CommunityDirectory, Exchange, NewIpoCommunity } from "../communities";
import { summarise, type IpoLookup } from "../ipoCommunity";
import { parseUpstoxIpoDetail } from "../../services/ipoParse";

/** Shared fakes for the community tests (not a test file itself). */

export const NOW = Date.parse("2026-10-24T06:00:00.000Z"); // 11:30 IST, 24 Oct

/** An Upstox GET /v2/ipos/{id} body, in the documented shape. */
export function upstoxDetailBody(overrides: Record<string, unknown> = {}, timeline: Record<string, unknown> = {}) {
  return {
    status: "success",
    data: {
      id: "tonbo-imaging-india-ipo",
      symbol: "TONBO",
      name: "Tonbo Imaging India IPO",
      isin: "INE0TON01017",
      issue_type: "regular",
      status: "closed",
      industry: "Defence",
      issue_size: "865",
      minimum_price: "300",
      maximum_price: "316",
      bidding_start_date: "2026-10-15",
      bidding_end_date: "2026-10-19",
      total_subscription: "96.63",
      lot_size: 47,
      minimum_quantity: 47,
      cut_off_price: "316",
      listing_price: null,
      listing_exchange: "BSE,NSE",
      timeline: { allotment_date: "2026-10-20", listing_date: "2026-10-22", ...timeline },
      ...overrides,
    },
  };
}

/** A lookup that answers from an Upstox body, like lookupIpo would. */
export function lookupFrom(bodies: Record<string, unknown>, calls: string[] = []): (id: string) => Promise<IpoLookup> {
  return async (id) => {
    calls.push(id);
    const body = bodies[id];
    if (body === undefined) return { ok: false, code: "not_found", message: "Upstox has no data for this IPO." };
    if (typeof body === "string") return { ok: false, code: body as "auth", message: `Upstox: ${body}` };
    const detail = parseUpstoxIpoDetail(body)!;
    return { ok: true, ipo: summarise(detail, NOW), detail };
  };
}

/**
 * An in-memory directory with the database's unique keys: one community per
 * ISIN, per IPO id and per (exchange, symbol).
 */
export function memoryDirectory(seed: Community[] = []) {
  const rows = new Map(seed.map((c) => [c.id, { ...c }]));
  let next = 1;
  const created: NewIpoCommunity[] = [];

  const find = (test: (c: Community) => boolean) => [...rows.values()].find(test) ?? null;

  const directory: CommunityDirectory & { rows: Map<string, Community>; created: NewIpoCommunity[] } = {
    rows,
    created,
    byIpoId: async (ipoId) => find((c) => c.ipoId === ipoId),
    byIsin: async (isin) => find((c) => c.isin === isin),
    byListing: async (exchange: Exchange, symbol: string) => find((c) => c.exchange === exchange && c.symbol === symbol),
    async ensureIpo(input) {
      const existing = find((c) => c.ipoId === input.ipoId) ?? (input.isin ? find((c) => c.isin === input.isin) : null);
      if (existing) return existing;
      created.push(input);
      const id = `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
      const row: Community = { id, type: "ipo", name: input.name, isin: input.isin, ipoId: input.ipoId, board: input.board, exchange: null, symbol: null, listedAt: null };
      rows.set(id, row);
      return row;
    },
  };
  return directory;
}

export const LINKED: Community = {
  id: "00000000-0000-4000-8000-0000000000aa",
  type: "stock",
  name: "Tonbo Imaging India IPO",
  isin: "INE0TON01017",
  ipoId: "tonbo-imaging-india-ipo",
  board: "mainboard",
  exchange: "NSE",
  symbol: "TONBO",
  listedAt: "2026-10-22T04:00:00.000Z",
};

/* ------------------------------------------------------------ Supabase client */

export type FakeQuery = {
  table: string;
  op: "select" | "insert" | "update" | "upsert";
  payload: unknown;
  filters: [string, string, unknown][];
  options?: unknown;
};

/** A minimal stand-in for the supabase-js query builder; `handler` answers each query. */
export function fakeSupabase(handler: (query: FakeQuery) => { data: unknown; error: { code?: string; message?: string } | null }) {
  const queries: FakeQuery[] = [];
  const client = {
    from(table: string) {
      const q: FakeQuery = { table, op: "select", payload: null, filters: [] };
      queries.push(q);
      const run = () => Promise.resolve(handler(q));
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (payload: unknown) => ((q.op = "insert"), (q.payload = payload), builder),
        update: (payload: unknown) => ((q.op = "update"), (q.payload = payload), builder),
        upsert: (payload: unknown, options: unknown) => ((q.op = "upsert"), (q.payload = payload), (q.options = options), builder),
        eq: (c: string, v: unknown) => (q.filters.push(["eq", c, v]), builder),
        is: (c: string, v: unknown) => (q.filters.push(["is", c, v]), builder),
        in: (c: string, v: unknown) => (q.filters.push(["in", c, v]), builder),
        order: () => builder,
        limit: () => builder,
        single: run,
        maybeSingle: run,
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => run().then(resolve, reject),
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, queries };
}
