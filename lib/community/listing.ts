import type { SupabaseClient } from "@supabase/supabase-js";

import { searchInstrumentsByIsin, type InstrumentSearch } from "../apis/upstoxInstruments";
import type { UpstoxErrorCode } from "../apis/upstox";
import { getAdminClient } from "../supabase/server";
import type { Exchange } from "./communities";
import { lookupIpo, type IpoLookup } from "./ipoCommunity";

/**
 * The listing transition: an IPO community becomes its company's permanent
 * stock community, on the same row, once the listing is verified.
 *
 * For each IPO community that is due a check:
 *   1. Upstox IPO details must say the issue is listed (listing price set,
 *      listing date passed, or status "listed") — never a guess.
 *   2. Upstox must give the issue an ISIN, and it must equal the one the
 *      community was created with (if it had one).
 *   3. Upstox instrument search, queried by that ISIN, must return exactly one
 *      trading symbol on NSE (preferred) or BSE whose row carries the SAME
 *      ISIN. Search results are fuzzy, so rows are filtered by ISIN equality;
 *      company names are never compared.
 *   4. The row is updated only while it is still an unlinked IPO community
 *      with that ISIN. A ticker another community holds is a unique-key
 *      conflict, and a linked row can't change again (database trigger).
 *
 * Every result is written to community_listing_checks with when to look
 * again, so a failure (Upstox token expired, issue not on the exchange yet)
 * is retried later. Re-running is harmless: linked rows are skipped, and
 * linking again with the same values is reported as already linked.
 */

export type ListingCandidate = {
  id: string;
  ipoId: string | null;
  isin: string | null;
  name: string;
  /** Failed or conflicting checks so far. */
  attempts: number;
};

export type LinkResult = "linked" | "already" | "conflict" | "mismatch";

export type CheckStatus = "waiting" | "linked" | "failed" | "conflict";

export type CheckRecord = {
  status: CheckStatus;
  attempts: number;
  error: string | null;
  checkedAt: string;
  nextCheckAt: string;
};

export interface ListingStore {
  /** Unlinked IPO communities whose next check is due (or never checked). */
  dueCommunities(nowIso: string, limit: number): Promise<ListingCandidate[]>;
  link(candidate: ListingCandidate, isin: string, exchange: Exchange, symbol: string, nowIso: string): Promise<LinkResult>;
  record(communityId: string, check: CheckRecord): Promise<void>;
}

export interface ListingDeps {
  lookup: (ipoId: string) => Promise<IpoLookup>;
  instruments: (isin: string, exchange: Exchange) => Promise<InstrumentSearch>;
  now: () => number;
}

export type ListingOutcome = {
  communityId: string;
  ipoId: string | null;
  status: CheckStatus | "skipped";
  exchange?: Exchange;
  symbol?: string;
  reason: string;
};

export type ListingReport = {
  checked: number;
  linked: number;
  waiting: number;
  failed: number;
  conflicts: number;
  /** Set when Upstox refused every call (token missing or expired): the rest were left for the next run. */
  stoppedEarly: string | null;
  outcomes: ListingOutcome[];
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const FAILURE_BASE_MS = 15 * MINUTE;
const MAX_BACKOFF_MS = 24 * HOUR;
const WAITING_RECHECK_MS = 6 * HOUR;
const CONFLICT_RECHECK_MS = 24 * HOUR;

/** Same rule as the communities_symbol_format check. */
const DB_SYMBOL = /^[A-Z0-9][A-Z0-9.&-]{0,19}$/;

export function failureBackoff(attempts: number): number {
  return Math.min(FAILURE_BASE_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

/** Token problems fail every call, so the run stops instead of burning retries. */
const isFatal = (code: UpstoxErrorCode) => code === "auth" || code === "not_configured";

type Step =
  | { kind: "linked"; exchange: Exchange; symbol: string; reason: string }
  | { kind: "waiting"; reason: string; nextAt: number }
  | { kind: "failed"; reason: string; fatal?: boolean }
  | { kind: "conflict"; reason: string };

/** Which exchanges to search, in order, from the exchanges Upstox lists the issue on. */
export function exchangesToTry(listingExchanges: string[]): Exchange[] {
  const listed = listingExchanges.filter((x): x is Exchange => x === "NSE" || x === "BSE");
  if (listed.length === 0) return ["NSE", "BSE"];
  return (["NSE", "BSE"] as const).filter((x) => listed.includes(x));
}

/** The one trading symbol that carries exactly this ISIN on this exchange, or why there isn't one. */
export function symbolForIsin(
  search: Extract<InstrumentSearch, { ok: true }>,
  isin: string,
  exchange: Exchange
): { symbol: string } | { none: true } | { ambiguous: string[] } {
  const symbols = new Set(
    search.rows.filter((row) => row.isin === isin && row.segment === `${exchange}_EQ`).map((row) => row.tradingSymbol)
  );
  if (symbols.size === 0) return { none: true };
  if (symbols.size > 1) return { ambiguous: [...symbols].sort() };
  return { symbol: [...symbols][0] };
}

async function decide(candidate: ListingCandidate, store: ListingStore, deps: ListingDeps, nowMs: number): Promise<Step> {
  if (!candidate.ipoId) return { kind: "failed", reason: "The community has no Upstox IPO id to check." };

  const found = await deps.lookup(candidate.ipoId);
  if (!found.ok) return { kind: "failed", reason: `Upstox IPO details: ${found.message}`, fatal: isFatal(found.code) };

  const { ipo } = found;
  if (ipo.listingState !== "listed") {
    // Look again on the listing date (≈ 9:30 IST), or in a few hours.
    const listingAt = ipo.listingDate ? Date.parse(`${ipo.listingDate}T04:00:00Z`) : NaN;
    const nextAt = Number.isFinite(listingAt) && listingAt > nowMs ? listingAt : nowMs + WAITING_RECHECK_MS;
    return { kind: "waiting", reason: ipo.listingDate ? `Not listed yet (listing date ${ipo.listingDate}).` : "Not listed yet; no listing date announced.", nextAt };
  }

  const isin = ipo.isin;
  if (!isin) return { kind: "failed", reason: "Upstox lists the issue as listed but has no ISIN for it yet." };
  if (candidate.isin && candidate.isin !== isin) {
    return { kind: "conflict", reason: `Upstox now reports ISIN ${isin}, but the community was created for ${candidate.isin}.` };
  }

  const notFound: string[] = [];
  for (const exchange of exchangesToTry(ipo.listingExchanges)) {
    const search = await deps.instruments(isin, exchange);
    if (!search.ok) {
      return { kind: "failed", reason: `Upstox instrument search (${exchange}): ${search.code}.`, fatal: isFatal(search.code) };
    }
    const match = symbolForIsin(search, isin, exchange);
    if ("none" in match) {
      notFound.push(exchange);
      continue;
    }
    if ("ambiguous" in match) {
      return { kind: "conflict", reason: `ISIN ${isin} maps to several ${exchange} symbols (${match.ambiguous.join(", ")}).` };
    }
    if (!DB_SYMBOL.test(match.symbol)) {
      return { kind: "conflict", reason: `${exchange} symbol "${match.symbol}" for ISIN ${isin} isn't a usable ticker.` };
    }

    const result = await store.link(candidate, isin, exchange, match.symbol, new Date(nowMs).toISOString());
    if (result === "linked" || result === "already") {
      return { kind: "linked", exchange, symbol: match.symbol, reason: result === "already" ? "Already linked." : `Linked to ${exchange}: ${match.symbol} by ISIN ${isin}.` };
    }
    return {
      kind: "conflict",
      reason:
        result === "conflict"
          ? `${exchange}: ${match.symbol} or ISIN ${isin} already belongs to another community.`
          : "The community changed while it was being linked (different ISIN or already linked elsewhere).",
    };
  }

  return { kind: "failed", reason: `No ${notFound.join(" or ")} instrument carries ISIN ${isin} yet.` };
}

export async function runListingTransition(store: ListingStore, deps: ListingDeps, limit = 50): Promise<ListingReport> {
  const nowMs = deps.now();
  const nowIso = new Date(nowMs).toISOString();
  const due = await store.dueCommunities(nowIso, limit);

  const report: ListingReport = { checked: 0, linked: 0, waiting: 0, failed: 0, conflicts: 0, stoppedEarly: null, outcomes: [] };

  for (const candidate of due) {
    if (report.stoppedEarly) {
      report.outcomes.push({ communityId: candidate.id, ipoId: candidate.ipoId, status: "skipped", reason: "Left for the next run." });
      continue;
    }

    let step: Step;
    try {
      step = await decide(candidate, store, deps, nowMs);
    } catch (error) {
      step = { kind: "failed", reason: `Unexpected error: ${error instanceof Error ? error.message : "unknown"}` };
    }

    report.checked++;
    const attempts = step.kind === "failed" || step.kind === "conflict" ? candidate.attempts + 1 : 0;
    const nextAt =
      step.kind === "waiting"
        ? step.nextAt
        : step.kind === "failed"
          ? nowMs + failureBackoff(attempts)
          : step.kind === "conflict"
            ? nowMs + CONFLICT_RECHECK_MS
            : nowMs;

    const status: CheckStatus = step.kind;
    await store.record(candidate.id, {
      status,
      attempts,
      error: status === "linked" || status === "waiting" ? null : step.reason,
      checkedAt: nowIso,
      nextCheckAt: new Date(nextAt).toISOString(),
    });

    if (status === "linked") report.linked++;
    else if (status === "waiting") report.waiting++;
    else if (status === "failed") report.failed++;
    else report.conflicts++;

    report.outcomes.push({
      communityId: candidate.id,
      ipoId: candidate.ipoId,
      status,
      reason: step.reason,
      ...(step.kind === "linked" ? { exchange: step.exchange, symbol: step.symbol } : {}),
    });

    if (step.kind === "failed" && step.fatal) report.stoppedEarly = step.reason;
  }

  return report;
}

/* ------------------------------------------------------------ Supabase */

type CheckRow = { community_id: string; status: CheckStatus; attempts: number; next_check_at: string };

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

export function supabaseListingStore(admin: SupabaseClient): ListingStore {
  return {
    async dueCommunities(nowIso, limit) {
      const { data: communities, error } = await admin
        .from("communities")
        .select("id, upstox_ipo_id, isin, name")
        .eq("type", "ipo")
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      if (!communities?.length) return [];

      const { data: checks, error: checksError } = await admin
        .from("community_listing_checks")
        .select("community_id, status, attempts, next_check_at")
        .in("community_id", communities.map((c) => c.id));
      if (checksError) throw checksError;

      const byId = new Map((checks as CheckRow[] | null ?? []).map((row) => [row.community_id, row]));
      return communities
        .filter((c) => {
          const check = byId.get(c.id);
          return !check || (check.status !== "linked" && check.next_check_at <= nowIso);
        })
        .slice(0, limit)
        .map((c) => ({ id: c.id, ipoId: c.upstox_ipo_id, isin: c.isin, name: c.name, attempts: byId.get(c.id)?.attempts ?? 0 }));
    },

    async link(candidate, isin, exchange, symbol, nowIso) {
      let query = admin
        .from("communities")
        .update({ type: "stock", isin, exchange, symbol, listed_at: nowIso })
        .eq("id", candidate.id)
        .eq("type", "ipo");
      query = candidate.isin ? query.eq("isin", isin) : query.is("isin", null);

      const { data, error } = await query.select("id");
      if (error) {
        if (error.code === UNIQUE_VIOLATION) return "conflict";
        if (error.code === CHECK_VIOLATION) return "mismatch";
        throw error;
      }
      if (data && data.length === 1) return "linked";

      // Nothing updated: already linked (a retry), or the row changed.
      const { data: row, error: readError } = await admin
        .from("communities")
        .select("type, isin, exchange, symbol")
        .eq("id", candidate.id)
        .maybeSingle();
      if (readError) throw readError;
      return row && row.type === "stock" && row.isin === isin && row.exchange === exchange && row.symbol === symbol ? "already" : "mismatch";
    },

    async record(communityId, check) {
      const { error } = await admin.from("community_listing_checks").upsert(
        {
          community_id: communityId,
          status: check.status,
          attempts: check.attempts,
          last_error: check.error,
          last_checked_at: check.checkedAt,
          next_check_at: check.nextCheckAt,
        },
        { onConflict: "community_id" }
      );
      if (error) throw error;
    },
  };
}

export function getListingStore(): ListingStore | null {
  const admin = getAdminClient();
  return admin ? supabaseListingStore(admin) : null;
}

export const defaultListingDeps: ListingDeps = {
  // Fresh details on every run: the 2-minute page cache is keyed the same way, which is fine for a cron.
  lookup: (ipoId) => lookupIpo(ipoId),
  instruments: searchInstrumentsByIsin,
  now: () => Date.now(),
};
