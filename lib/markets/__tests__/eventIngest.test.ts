import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseNseEquityMaster } from "../../apis/nseEquityMaster";
import {
  buildEventRows,
  ingestIfDue,
  ingestNseEvents,
  resetIngestThrottle,
  toMarketEvent,
  type MarketEvent,
  type MarketEventRow,
  type MarketEventStore,
} from "../eventIngest";
import { NSE_BOARD_MEETINGS_URL, NSE_CORPORATE_ACTIONS_URL, parseBoardMeetings, parseCorporateActions } from "../nseEvents";
import { GET as marketEventsRoute } from "../../../app/api/events/market/route";
import { GET as ingestRoute } from "../../../app/api/events/ingest/route";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const MASTER_CSV = fixture("nse-equity-master-subset-2026-10-29.csv");
const ACTIONS_XML = fixture("nse-corporate-actions-2026-10-29.xml");
const MEETINGS_XML = fixture("nse-board-meetings-2026-10-29.xml");
const MASTER = parseNseEquityMaster(MASTER_CSV)!;

/** An in-memory store that behaves like the table: raw_hash is unique. */
function memoryStore() {
  const rows = new Map<string, MarketEventRow & { id: string }>();
  const store: MarketEventStore = {
    async insertNew(batch) {
      let added = 0;
      for (const row of batch) {
        if (rows.has(row.raw_hash)) continue;
        rows.set(row.raw_hash, { ...row, id: `id-${rows.size + 1}` });
        added++;
      }
      return added;
    },
    async list({ symbol, from, to, limit }) {
      return [...rows.values()]
        .filter((r) => r.event_date && r.event_date >= from && r.event_date <= to && (!symbol || r.symbol === symbol))
        .slice(0, limit)
        .map(toMarketEvent);
    },
  };
  return { store, rows };
}

const feeds = (overrides: Partial<Record<string, string | null>> = {}) =>
  (async (input: string | URL | Request) => {
    const url = String(input);
    const body = url in overrides ? overrides[url] : url === NSE_CORPORATE_ACTIONS_URL ? ACTIONS_XML : url === NSE_BOARD_MEETINGS_URL ? MEETINGS_XML : null;
    return body === null || body === undefined ? new Response("", { status: 503 }) : new Response(body, { status: 200 });
  }) as typeof fetch;

test("rows: every action and meeting, mapped exactly or unmapped with the reason", () => {
  const rows = buildEventRows(parseCorporateActions(ACTIONS_XML), parseBoardMeetings(MEETINGS_XML), MASTER);
  const actions = rows.filter((r) => r.source === "nse_corporate_actions");
  const meetings = rows.filter((r) => r.source === "nse_board_meetings");
  assert.equal(actions.length, 16);
  assert.ok(actions.every((r) => r.mapping_status === "mapped" && r.symbol && /^IN[A-Z0-9]{9}[0-9]$/.test(r.isin ?? "")));

  const unmapped = meetings.filter((r) => r.mapping_status === "unmapped");
  assert.ok(unmapped.length >= 1);
  assert.ok(unmapped.every((r) => r.symbol === null && r.isin === null && r.unmapped_reason === "not_listed"));
  assert.ok(meetings.some((r) => r.kind === "results"));
  assert.ok(meetings.some((r) => r.kind === "board_meeting"));

  for (const row of rows) {
    assert.match(row.raw_hash, /^[0-9a-f]{64}$/);
    assert.match(row.source_url, /^https:\/\/[a-z0-9.-]+\.nseindia\.com\//);
  }
  assert.equal(new Set(rows.map((r) => r.raw_hash)).size, rows.length);
});

test("a link that isn't an NSE page is replaced by the feed's own address", () => {
  const [row] = buildEventRows(
    [{ company: "Ador Welding Limited", kind: "dividend", purpose: "DIVIDEND", series: "EQ", exDate: "2026-11-04", recordDate: null, publishedAt: null, link: "javascript:alert(1)" }],
    [],
    MASTER
  );
  assert.equal(row.source_url, NSE_CORPORATE_ACTIONS_URL);
  assert.equal(row.symbol, "ADOR");
});

test("re-ingesting the same feeds stores nothing new", async () => {
  const { store, rows } = memoryStore();
  const first = await ingestNseEvents(store, feeds(), async () => MASTER);
  assert.ok("inserted" in first && first.inserted > 30);
  const count = rows.size;
  const second = await ingestNseEvents(store, feeds(), async () => MASTER);
  assert.ok("inserted" in second && second.inserted === 0);
  assert.equal(rows.size, count);
});

test("without the equity list nothing is stored; one feed down still stores the other", async () => {
  const { store, rows } = memoryStore();
  assert.deepEqual(await ingestNseEvents(store, feeds(), async () => null), { skipped: "master_unavailable" });
  assert.equal(rows.size, 0);

  const result = await ingestNseEvents(store, feeds({ [NSE_BOARD_MEETINGS_URL]: null }), async () => MASTER);
  assert.ok("feedsFailed" in result);
  assert.deepEqual(result.feedsFailed, ["nse_board_meetings"]);
  assert.ok([...rows.values()].every((r) => r.source === "nse_corporate_actions"));
});

test("ingestIfDue runs at most once per ten minutes and never throws", async () => {
  resetIngestThrottle();
  const { store } = memoryStore();
  let runs = 0;
  const ingest = async () => {
    runs++;
    throw new Error("NSE down");
  };
  await ingestIfDue(store, 1_000_000, 50, ingest);
  await ingestIfDue(store, 1_000_000 + 60_000, 50, ingest);
  assert.equal(runs, 1);
  await ingestIfDue(store, 1_000_000 + 11 * 60_000, 50, ingest);
  assert.equal(runs, 2);
  resetIngestThrottle();
});

test("GET /api/events/market: today's IST window, symbol filter, validation and not-migrated", async () => {
  const { store } = memoryStore();
  await ingestNseEvents(store, feeds(), async () => MASTER);
  const now = () => Date.parse("2026-10-29T06:00:00Z");
  const noRefresh = async () => {};

  const all = await (await marketEventsRoute(new Request("http://x/api/events/market?days=30"), undefined, store, now, noRefresh)).json();
  assert.equal(all.success, true);
  assert.equal(all.from, "2026-10-29");
  assert.ok(all.events.length > 0);

  const genus = all.events.find((e: MarketEvent) => e.company === "Genus Power Infrastructures Limited");
  assert.ok(genus?.symbol);
  const one = await (await marketEventsRoute(new Request(`http://x/api/events/market?symbol=${genus.symbol}.NS`), undefined, store, now, noRefresh)).json();
  assert.ok(one.events.length >= 1 && one.events.every((e: MarketEvent) => e.symbol === genus.symbol));

  assert.equal((await marketEventsRoute(new Request("http://x/api/events/market?days=500"), undefined, store, now, noRefresh)).status, 400);
  assert.equal((await marketEventsRoute(new Request("http://x/api/events/market?symbol=<script>"), undefined, store, now, noRefresh)).status, 400);
  assert.equal((await marketEventsRoute(new Request("http://x/api/events/market"), undefined, null, now, noRefresh)).status, 503);

  const missing: MarketEventStore = {
    insertNew: async () => 0,
    list: async () => {
      throw { code: "PGRST205", message: "Could not find the table 'public.market_events'" };
    },
  };
  const res = await marketEventsRoute(new Request("http://x/api/events/market"), undefined, missing, now, noRefresh);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "NOT_CONFIGURED");
});

test("GET /api/events/ingest is closed without the cron secret", async () => {
  const { store } = memoryStore();
  const ingest = async () => ({ read: 0, inserted: 0, unmapped: 0, feedsFailed: [] });
  assert.equal((await ingestRoute(new Request("http://x/api/events/ingest"), undefined, undefined, store, ingest)).status, 401);
  assert.equal((await ingestRoute(new Request("http://x/api/events/ingest", { headers: { authorization: "Bearer wrong" } }), undefined, "s3cret", store, ingest)).status, 401);
  const ok = await ingestRoute(new Request("http://x/api/events/ingest", { headers: { authorization: "Bearer s3cret" } }), undefined, "s3cret", store, ingest);
  assert.equal(ok.status, 200);
});
