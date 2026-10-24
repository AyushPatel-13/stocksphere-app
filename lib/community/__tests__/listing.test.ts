import { test } from "node:test";
import assert from "node:assert/strict";

import type { InstrumentRow, InstrumentSearch } from "../../apis/upstoxInstruments";
import { parseInstrumentSearch } from "../../apis/upstoxInstruments";
import type { Exchange } from "../communities";
import {
  exchangesToTry,
  failureBackoff,
  runListingTransition,
  supabaseListingStore,
  type CheckRecord,
  type LinkResult,
  type ListingCandidate,
  type ListingDeps,
  type ListingStore,
} from "../listing";
import { POST as listingRoute } from "@/app/api/community/listing/route";
import { NOW, fakeSupabase, lookupFrom, upstoxDetailBody } from "./fakes";

const IPO = "tonbo-imaging-india-ipo";
const ISIN = "INE0TON01017";

const LISTED = upstoxDetailBody({ status: "listed", listing_price: "402.5" });

function candidate(overrides: Partial<ListingCandidate> = {}): ListingCandidate {
  return { id: "00000000-0000-4000-8000-0000000000aa", ipoId: IPO, isin: ISIN, name: "Tonbo Imaging India IPO", attempts: 0, ...overrides };
}

function row(tradingSymbol: string, segment: string, isin: string | null = ISIN, name = "TONBO IMAGING INDIA LIMITED"): InstrumentRow {
  return { tradingSymbol, segment, isin, instrumentKey: `${segment}|${isin}`, instrumentType: "EQ", name };
}

/** A store backed by plain objects, with the database's one-ticker-per-community rule. */
function memoryStore(due: ListingCandidate[], taken: Record<string, string> = {}) {
  const linked = new Map<string, { exchange: Exchange; symbol: string; isin: string }>();
  const records = new Map<string, CheckRecord>();
  const links: string[] = [];
  const store: ListingStore = {
    dueCommunities: async (nowIso) =>
      due.filter((c) => !linked.has(c.id) && (!records.has(c.id) || records.get(c.id)!.nextCheckAt <= nowIso)).map((c) => ({ ...c, attempts: records.get(c.id)?.attempts ?? c.attempts })),
    link: async (c, isin, exchange, symbol): Promise<LinkResult> => {
      links.push(`${c.id}→${exchange}:${symbol}`);
      const owner = taken[`${exchange}:${symbol}`];
      if (owner && owner !== c.id) return "conflict";
      const current = linked.get(c.id);
      if (current) return current.exchange === exchange && current.symbol === symbol && current.isin === isin ? "already" : "mismatch";
      linked.set(c.id, { exchange, symbol, isin });
      return "linked";
    },
    record: async (id, check) => {
      records.set(id, check);
    },
  };
  return { store, linked, records, links };
}

function deps(overrides: Partial<ListingDeps> & { bodies?: Record<string, unknown>; search?: Partial<Record<Exchange, InstrumentSearch>> } = {}): ListingDeps & { searches: string[] } {
  const searches: string[] = [];
  const search = overrides.search ?? { NSE: { ok: true, rows: [row("TONBO", "NSE_EQ")] }, BSE: { ok: true, rows: [row("TONBO", "BSE_EQ")] } };
  return {
    searches,
    lookup: overrides.lookup ?? lookupFrom(overrides.bodies ?? { [IPO]: LISTED }),
    instruments:
      overrides.instruments ??
      (async (isin, exchange) => {
        searches.push(`${exchange}:${isin}`);
        return search[exchange] ?? { ok: true, rows: [] };
      }),
    now: overrides.now ?? (() => NOW),
  };
}

/* ------------------------------------------------ AC7: a verified listing links the same community */

test("AC7: a listed IPO whose ISIN maps to one NSE symbol is linked in place", async () => {
  const { store, linked, records } = memoryStore([candidate()]);
  const d = deps();
  const report = await runListingTransition(store, d);

  assert.equal(report.linked, 1);
  assert.deepEqual(linked.get(candidate().id), { exchange: "NSE", symbol: "TONBO", isin: ISIN });
  assert.equal(records.get(candidate().id)?.status, "linked");
  assert.deepEqual(d.searches, [`NSE:${ISIN}`], "NSE is preferred; the search is by ISIN");
  assert.deepEqual(report.outcomes[0], { communityId: candidate().id, ipoId: IPO, status: "linked", exchange: "NSE", symbol: "TONBO", reason: `Linked to NSE: TONBO by ISIN ${ISIN}.` });
});

test("AC7: a BSE-only listing links to its BSE symbol", async () => {
  const { store, linked } = memoryStore([candidate()]);
  const bseOnly = upstoxDetailBody({ status: "listed", listing_price: "402.5", listing_exchange: "BSE" });
  const d = deps({ bodies: { [IPO]: bseOnly }, search: { BSE: { ok: true, rows: [row("TONBO", "BSE_EQ")] } } });
  await runListingTransition(store, d);
  assert.deepEqual(linked.get(candidate().id), { exchange: "BSE", symbol: "TONBO", isin: ISIN });
  assert.deepEqual(d.searches, [`BSE:${ISIN}`]);
});

test("AC7: a community created before Upstox had an ISIN takes the verified one", async () => {
  const { store, linked } = memoryStore([candidate({ isin: null })]);
  await runListingTransition(store, deps());
  assert.equal(linked.get(candidate().id)?.isin, ISIN);
});

/* ------------------------------------------------ AC8: never a wrong attachment */

test("AC8: not listed yet → waiting until the listing date, nothing attached", async () => {
  const { store, linked, records } = memoryStore([candidate()]);
  const awaiting = upstoxDetailBody({}, { listing_date: "2026-10-27" });
  const report = await runListingTransition(store, deps({ bodies: { [IPO]: awaiting } }));
  assert.equal(report.waiting, 1);
  assert.equal(linked.size, 0);
  assert.equal(records.get(candidate().id)?.nextCheckAt, "2026-10-27T04:00:00.000Z");
  assert.equal(records.get(candidate().id)?.attempts, 0);
});

test("AC8: no ISIN, a changed ISIN, several tickers or a taken ticker are never attached", async () => {
  const cases: [string, ListingDeps, string, Record<string, string>?][] = [
    ["no ISIN", deps({ bodies: { [IPO]: upstoxDetailBody({ status: "listed", listing_price: "402.5", isin: null }) } }), "failed"],
    ["changed ISIN", deps({ bodies: { [IPO]: upstoxDetailBody({ status: "listed", listing_price: "402.5", isin: "INE0TON01025" }) } }), "conflict"],
    ["two tickers", deps({ search: { NSE: { ok: true, rows: [row("TONBO", "NSE_EQ"), row("TONBO-BE", "NSE_EQ")] } } }), "conflict"],
    ["ticker taken", deps(), "conflict", { "NSE:TONBO": "someone-else" }],
  ];
  for (const [label, d, expected, taken] of cases) {
    const { store, linked, records } = memoryStore([candidate()], taken);
    await runListingTransition(store, d);
    assert.equal(linked.size, 0, label);
    assert.equal(records.get(candidate().id)?.status, expected, label);
    assert.ok(records.get(candidate().id)?.error, label);
  }
});

test("AC8: a same-named company with a different ISIN, or a row on the wrong exchange, is not a match", async () => {
  const lookalikes: InstrumentSearch = {
    ok: true,
    rows: [row("TONBO", "NSE_EQ", "INE999Z01011", "TONBO IMAGING INDIA LIMITED"), row("TONBO", "BSE_EQ", ISIN), row("TONBOX", "NSE_EQ", null)],
  };
  const { store, linked, records } = memoryStore([candidate()]);
  const d = deps({ search: { NSE: lookalikes, BSE: { ok: true, rows: [] } } });
  await runListingTransition(store, d);
  assert.equal(linked.size, 0);
  assert.equal(records.get(candidate().id)?.status, "failed");
  assert.match(records.get(candidate().id)?.error ?? "", /No NSE or BSE instrument carries ISIN/);
});

/* ------------------------------------------------ AC9: idempotent, retry-safe, failures recorded */

test("AC9: running twice links once; a linked community is never checked again", async () => {
  const { store, links } = memoryStore([candidate()]);
  const first = await runListingTransition(store, deps());
  const second = await runListingTransition(store, deps());
  assert.equal(first.linked, 1);
  assert.equal(second.checked, 0);
  assert.equal(links.length, 1);
});

test("AC9: Upstox unavailable is recorded with a backoff and retried later, then links", async () => {
  const due = [candidate(), candidate({ id: "00000000-0000-4000-8000-0000000000bb", ipoId: "other-ipo", isin: null })];
  const { store, records, linked } = memoryStore(due);

  // Expired token: the first fails and the run stops instead of failing the rest.
  const down = await runListingTransition(store, deps({ bodies: { [IPO]: "auth", "other-ipo": "auth" } }));
  assert.equal(down.failed, 1);
  assert.match(down.stoppedEarly ?? "", /Upstox/);
  assert.equal(down.outcomes[1].status, "skipped");
  assert.equal(records.has(due[1].id), false, "skipped ones keep their schedule and attempts");
  const failed = records.get(due[0].id)!;
  assert.equal(failed.attempts, 1);
  assert.equal(Date.parse(failed.nextCheckAt) - NOW, failureBackoff(1));

  // Not due yet: nothing is retried early.
  const early = await runListingTransition(store, deps({ now: () => NOW + 60_000 }));
  assert.equal(early.outcomes.find((o) => o.communityId === due[0].id), undefined);

  // Later, with Upstox back: linked.
  const later = await runListingTransition(store, deps({ now: () => NOW + failureBackoff(1) + 1 }));
  assert.equal(later.outcomes.find((o) => o.communityId === due[0].id)?.status, "linked");
  assert.equal(linked.get(due[0].id)?.symbol, "TONBO");
});

test("AC9: a search outage or a thrown error is a recorded failure, not a crash", async () => {
  const { store, records } = memoryStore([candidate()]);
  await runListingTransition(store, deps({ search: { NSE: { ok: false, code: "timeout" } } }));
  assert.equal(records.get(candidate().id)?.status, "failed");

  const { store: s2, records: r2 } = memoryStore([candidate()]);
  await runListingTransition(s2, deps({ instruments: async () => { throw new Error("socket hang up"); } }));
  assert.match(r2.get(candidate().id)?.error ?? "", /socket hang up/);
});

test("backoff grows and is capped at a day", () => {
  assert.equal(failureBackoff(1), 15 * 60_000);
  assert.equal(failureBackoff(2), 30 * 60_000);
  assert.equal(failureBackoff(20), 24 * 60 * 60_000);
  assert.deepEqual(exchangesToTry([]), ["NSE", "BSE"]);
  assert.deepEqual(exchangesToTry(["BSE", "NSE"]), ["NSE", "BSE"]);
  assert.deepEqual(exchangesToTry(["BSE"]), ["BSE"]);
});

/* ------------------------------------------------ the Supabase store */

test("the store's link only updates an unlinked row with the same ISIN, and treats a retry as already linked", async () => {
  // First call: the conditional update matches nothing (already linked by an earlier run).
  const { client, queries } = fakeSupabase((q) => {
    if (q.op === "update") return { data: [], error: null };
    return { data: { type: "stock", isin: ISIN, exchange: "NSE", symbol: "TONBO" }, error: null };
  });
  const store = supabaseListingStore(client);
  assert.equal(await store.link(candidate(), ISIN, "NSE", "TONBO", new Date(NOW).toISOString()), "already");
  const update = queries.find((q) => q.op === "update")!;
  assert.deepEqual(update.filters, [["eq", "id", candidate().id], ["eq", "type", "ipo"], ["eq", "isin", ISIN]]);

  // A ticker another community holds (unique index) is a conflict, not an error.
  const taken = supabaseListingStore(fakeSupabase(() => ({ data: null, error: { code: "23505" } })).client);
  assert.equal(await taken.link(candidate(), ISIN, "NSE", "TONBO", new Date(NOW).toISOString()), "conflict");

  // Linked elsewhere (the row says another symbol): a mismatch.
  const other = supabaseListingStore(
    fakeSupabase((q) => (q.op === "update" ? { data: [], error: null } : { data: { type: "stock", isin: ISIN, exchange: "NSE", symbol: "OTHER" }, error: null })).client
  );
  assert.equal(await other.link(candidate(), ISIN, "NSE", "TONBO", new Date(NOW).toISOString()), "mismatch");
});

test("the store records each check by community id (upsert)", async () => {
  const { client, queries } = fakeSupabase(() => ({ data: null, error: null }));
  await supabaseListingStore(client).record(candidate().id, { status: "failed", attempts: 2, error: "x", checkedAt: "a", nextCheckAt: "b" });
  assert.deepEqual(queries[0].options, { onConflict: "community_id" });
  assert.equal((queries[0].payload as { last_error: string }).last_error, "x");
});

test("instrument search rows are parsed with their ISIN, and junk is refused", () => {
  const rows = parseInstrumentSearch({
    status: "success",
    data: [
      { trading_symbol: "TCS", segment: "NSE_EQ", isin: "INE467B01029", instrument_key: "NSE_EQ|INE467B01029", instrument_type: "EQ" },
      { trading_symbol: "", segment: "NSE_EQ", instrument_key: "x" },
    ],
  });
  assert.deepEqual(rows?.map((r) => [r.tradingSymbol, r.isin]), [["TCS", "INE467B01029"]]);
  assert.equal(parseInstrumentSearch({ status: "error" }), null);
});

/* ------------------------------------------------ the cron route */

test("the listing route needs CRON_SECRET and reports what it did", async () => {
  const request = (auth?: string) => new Request("http://x/api/community/listing", { method: "POST", headers: auth ? { Authorization: auth } : {} });
  const { store } = memoryStore([candidate()]);

  assert.equal((await listingRoute(request("Bearer s3cret"), undefined, undefined, store, deps())).status, 401);
  assert.equal((await listingRoute(request(), undefined, "s3cret", store, deps())).status, 401);
  assert.equal((await listingRoute(request("Bearer wrong"), undefined, "s3cret", store, deps())).status, 401);
  assert.equal((await listingRoute(request("Bearer s3cret"), undefined, "s3cret", null, deps())).status, 503);

  const ok = await listingRoute(request("Bearer s3cret"), undefined, "s3cret", store, deps());
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).linked, 1);

  const unmigrated: ListingStore = { ...store, dueCommunities: async () => { throw { code: "42P01" }; } };
  assert.equal((await listingRoute(request("Bearer s3cret"), undefined, "s3cret", unmigrated, deps())).status, 503);
});
