import { test } from "node:test";
import assert from "node:assert/strict";

import type { MarketSnapshot, PredictionMarketData } from "../../predictions/v2/sources";
import {
  cleanEvidenceUrl,
  closeThesis,
  createThesis,
  deleteThesis,
  isThesisScoringEnabled,
  parseThesisContent,
  publishThesis,
  resolveThesisListing,
  reviseThesis,
  thesisOutcome,
  type ThesisContent,
  type ThesisStore,
} from "../service";

const NOW = Date.parse("2026-10-29T06:00:00Z"); // 11:30 IST, NSE open
const CONTENT = {
  title: "Margins recover as input costs fall",
  summary: "Steel prices are down 12% this year; the next two quarters should show it.",
  stance: "bullish",
  targetDate: "2027-04-30",
  targetPrice: "1650",
  risks: "A rebound in coal prices.",
  invalidation: "Two more quarters of falling margins.",
  evidence: [{ label: "Q2 results", url: "https://nsearchives.nseindia.com/corporate/x.pdf" }],
};

test("content: required fields, limits, target date window, https-only evidence", () => {
  const ok = parseThesisContent(CONTENT, NOW);
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.value.targetPrice, 1650);
  assert.equal(ok.ok && ok.value.evidence[0].label, "Q2 results");

  const bad = (patch: Record<string, unknown>) => parseThesisContent({ ...CONTENT, ...patch }, NOW);
  assert.equal(bad({ title: "ab" }).ok, false);
  assert.equal(bad({ summary: "short" }).ok, false);
  assert.equal(bad({ stance: "moon" }).ok, false);
  assert.equal(bad({ targetDate: "2026-11-01" }).ok, false); // under 7 days
  assert.equal(bad({ targetDate: "2030-01-01" }).ok, false); // over three years
  assert.equal(bad({ targetDate: "2027-02-30" }).ok, false); // not a real day
  assert.equal(bad({ targetPrice: "-3" }).ok, false);
  assert.equal(bad({ risks: "x".repeat(2001) }).ok, false);
  assert.equal(bad({ evidence: [{ url: "javascript:alert(1)" }] }).ok, false);
  assert.equal(bad({ evidence: [{ url: "http://example.com" }] }).ok, false);
  assert.equal(bad({ evidence: Array.from({ length: 11 }, () => ({ url: "https://a.com" })) }).ok, false);
  assert.equal(cleanEvidenceUrl("https://user:pw@example.com/x"), null);
  assert.equal(parseThesisContent({ ...CONTENT, targetPrice: "" }, NOW).ok && true, true);
});

test("listing: resolved server-side; retired listings and indices refused", () => {
  assert.deepEqual(resolveThesisListing("tcs.ns"), { ok: true, value: { symbol: "TCS", exchange: "NSE", lookup: "TCS.NS" } });
  assert.deepEqual(resolveThesisListing("RELIANCE.BO"), { ok: true, value: { symbol: "RELIANCE", exchange: "BSE", lookup: "RELIANCE.BO" } });
  assert.equal(resolveThesisListing("TATAMOTORS").ok, false);
  assert.equal(resolveThesisListing("^NSEI").ok, false);
  assert.equal(resolveThesisListing("<script>").ok, false);
  assert.equal(resolveThesisListing(42).ok, false);
});

test("outcome: never before the target date; judged against the frozen reference and benchmark", () => {
  const base = { stance: "bullish" as const, targetDate: "2027-04-30", referencePrice: 100, priceAtTarget: 112 };
  assert.deepEqual(thesisOutcome(base, Date.parse("2027-04-30T10:00:00Z")), { status: "not_due", dueOn: "2027-04-30" });
  const after = Date.parse("2027-05-02T00:00:00Z");
  const up = thesisOutcome(base, after);
  assert.equal(up.status === "scored" && up.verdict, "supported");
  assert.equal(up.status === "scored" && up.returnPct, 12);
  // Up 12% but the index was up 15%: behind the benchmark, so not supported.
  const behind = thesisOutcome({ ...base, benchmarkReturnPct: 15 }, after);
  assert.equal(behind.status === "scored" && behind.verdict, "not_supported");
  assert.equal(behind.status === "scored" && behind.excessPct, -3);
  // Inside ±2%: inconclusive. Neutral: always inconclusive.
  assert.equal((thesisOutcome({ ...base, priceAtTarget: 101 }, after) as { verdict: string }).verdict, "inconclusive");
  assert.equal((thesisOutcome({ ...base, stance: "neutral" }, after) as { verdict: string }).verdict, "inconclusive");
  assert.equal((thesisOutcome({ ...base, stance: "bearish", priceAtTarget: 90, targetPrice: 95 }, after) as { targetReached: boolean }).targetReached, true);
  assert.deepEqual(thesisOutcome({ ...base, priceAtTarget: null }, after), { status: "unavailable" });
});

test("scoring is off unless the server flag is exactly 'true'", () => {
  assert.equal(isThesisScoringEnabled({}), false);
  assert.equal(isThesisScoringEnabled({ THESIS_SCORING_ENABLED: "1" }), false);
  assert.equal(isThesisScoringEnabled({ THESIS_SCORING_ENABLED: "true" }), true);
});

/* ------------------------------------------------------------ flows */

type Row = { authorId: string; status: "draft" | "published" | "closed"; currentVersion: number; deleted: boolean; symbol: string; exchange: "NSE" | "BSE" | "US"; versions: Map<number, ThesisContent>; reference?: number; publishedVersion?: number };

function fakeStore() {
  const theses = new Map<string, Row>();
  const users: Record<string, string> = { "tok-a": "user-a", "tok-b": "user-b", "tok-noprofile": "user-c" };
  let versionsToday = 0;
  const store: ThesisStore = {
    verifyToken: async (t) => users[t] ?? null,
    hasProfile: async (u) => u !== "user-c",
    countSince: async (u) => ({ theses: [...theses.values()].filter((t) => t.authorId === u).length, versions: versionsToday }),
    create: async (row, content) => {
      const id = `00000000-0000-4000-8000-${String(theses.size + 1).padStart(12, "0")}`;
      theses.set(id, { authorId: row.author_id, status: "draft", currentVersion: 1, deleted: false, symbol: row.symbol, exchange: row.exchange, versions: new Map([[1, content]]) });
      return id;
    },
    getOwned: async (id) => theses.get(id) ?? null,
    addVersion: async (id, version, content) => {
      const t = theses.get(id)!;
      if (t.versions.has(version)) return "conflict";
      t.versions.set(version, content);
      t.currentVersion = version;
      versionsToday++;
      return "ok";
    },
    publish: async (id, fields) => {
      const t = theses.get(id)!;
      t.status = "published";
      t.reference = fields.reference_price;
      t.publishedVersion = fields.published_version;
    },
    close: async (id) => void (theses.get(id)!.status = "closed"),
    softDelete: async (id) => void (theses.get(id)!.deleted = true),
    detail: async () => null,
    list: async () => [],
  };
  return { store, theses };
}

function market(snapshot: Partial<MarketSnapshot> | null): PredictionMarketData {
  return {
    snapshot: async (_type, symbol) =>
      snapshot === null
        ? null
        : {
            symbol: symbol.replace(/\.(NS|BO)$/, "") + (symbol.endsWith(".NS") ? ".NS" : ""),
            currency: "INR",
            session: { start: NOW - 2 * 3_600_000, end: NOW + 4 * 3_600_000 },
            live: [{ price: 1480.5, quoteTime: NOW - 30_000, source: "upstox" }],
            lastClose: { price: 1470, time: NOW - 86_400_000, source: "yahoo" },
            dailyCloses: [],
            ...snapshot,
          },
  };
}

test("create → revise → publish → close: versions only grow and the reference is read by the server", async () => {
  const { store, theses } = fakeStore();
  const created = await createThesis({ token: "tok-a", symbol: "TATASTEEL.NS", content: CONTENT }, store, market({}), NOW);
  assert.ok(created.ok);
  const id = created.ok ? created.value.id : "";
  assert.equal(theses.get(id)?.symbol, "TATASTEEL");
  assert.equal(theses.get(id)?.exchange, "NSE");

  const revised = await reviseThesis({ token: "tok-a", id, content: { ...CONTENT, title: "Margins recover, slower than hoped" } }, store, NOW);
  assert.deepEqual(revised, { ok: true, value: { version: 2 } });
  assert.equal(theses.get(id)?.versions.get(1)?.title, CONTENT.title); // version 1 untouched

  const published = await publishThesis({ token: "tok-a", id }, store, market({}), NOW);
  assert.deepEqual(published, { ok: true, value: { referencePrice: 1480.5 } });
  assert.equal(theses.get(id)?.publishedVersion, 2);
  assert.equal((await publishThesis({ token: "tok-a", id }, store, market({}), NOW)).ok, false);

  assert.ok((await reviseThesis({ token: "tok-a", id, content: CONTENT }, store, NOW)).ok); // an update after publishing is version 3
  assert.ok((await closeThesis({ token: "tok-a", id }, store, NOW)).ok);
  const afterClose = await reviseThesis({ token: "tok-a", id, content: CONTENT }, store, NOW);
  assert.equal(!afterClose.ok && afterClose.code, "CLOSED");
});

test("only the author can change a thesis; signed-out, no-profile and other members are refused", async () => {
  const { store } = fakeStore();
  const created = await createThesis({ token: "tok-a", symbol: "TCS", content: CONTENT }, store, market({}), NOW);
  const id = created.ok ? created.value.id : "";
  assert.equal((await createThesis({ token: null, symbol: "TCS", content: CONTENT }, store, market({}), NOW)).ok, false);
  const noProfile = await createThesis({ token: "tok-noprofile", symbol: "TCS", content: CONTENT }, store, market({}), NOW);
  assert.equal(!noProfile.ok && noProfile.status, 403);
  for (const attempt of [
    reviseThesis({ token: "tok-b", id, content: CONTENT }, store, NOW),
    publishThesis({ token: "tok-b", id }, store, market({}), NOW),
    closeThesis({ token: "tok-b", id }, store, NOW),
    deleteThesis({ token: "tok-b", id }, store, NOW),
  ]) {
    const result = await attempt;
    assert.equal(!result.ok && result.status, 404);
  }
  assert.ok((await deleteThesis({ token: "tok-a", id }, store, NOW)).ok);
  const gone = await reviseThesis({ token: "tok-a", id, content: CONTENT }, store, NOW);
  assert.equal(!gone.ok && gone.status, 404);
});

test("publishing refuses a stale live price and an unknown listing", async () => {
  const { store } = fakeStore();
  const created = await createThesis({ token: "tok-a", symbol: "TCS", content: CONTENT }, store, market({}), NOW);
  const id = created.ok ? created.value.id : "";
  const stale = await publishThesis({ token: "tok-a", id }, store, market({ live: [{ price: 1480, quoteTime: NOW - 3_600_000, source: "upstox" }] }), NOW);
  assert.equal(!stale.ok && stale.code, "PRICE_UNAVAILABLE");
  const unknown = await createThesis({ token: "tok-a", symbol: "NOTREAL", content: CONTENT }, store, market(null), NOW);
  assert.equal(!unknown.ok && unknown.status, 400);
});

test("a US listing is stored as exchange US with its ticker", async () => {
  const { store, theses } = fakeStore();
  const created = await createThesis({ token: "tok-a", symbol: "aapl", content: CONTENT }, store, market({ currency: "USD" }), NOW);
  const id = created.ok ? created.value.id : "";
  assert.equal(theses.get(id)?.exchange, "US");
  assert.equal(theses.get(id)?.symbol, "AAPL");
});

test("daily limits on new theses", async () => {
  const { store } = fakeStore();
  for (let i = 0; i < 10; i++) assert.ok((await createThesis({ token: "tok-a", symbol: "TCS", content: CONTENT }, store, market({}), NOW)).ok);
  const eleventh = await createThesis({ token: "tok-a", symbol: "TCS", content: CONTENT }, store, market({}), NOW);
  assert.equal(!eleventh.ok && eleventh.code, "RATE_LIMITED");
});
