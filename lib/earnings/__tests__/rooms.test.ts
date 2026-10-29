import { test } from "node:test";
import assert from "node:assert/strict";

import type { MarketEvent, MarketEventStore } from "../../markets/eventIngest";
import { getRoom, istDay, listRooms, roomHref, roomState, roomsFrom } from "../rooms";

const NOW = Date.parse("2026-10-29T06:00:00Z"); // 11:30 IST

const event = (patch: Partial<MarketEvent>): MarketEvent => ({
  id: Math.random().toString(36).slice(2),
  source: "nse_board_meetings",
  kind: "results",
  company: "Rico Auto Industries Limited",
  mapped: true,
  unmappedReason: null,
  symbol: "RICOAUTO",
  isin: "INE209B01025",
  exchange: "NSE",
  purpose: "Financial Results",
  eventDate: "2026-11-06",
  recordDate: null,
  publishedAt: "2026-10-29T11:05:42+05:30",
  sourceUrl: "https://nsearchives.nseindia.com/corporate/RICOAUTO_29102026110542_x.pdf",
  ...patch,
});

test("state follows the meeting date in IST; a date-only meeting is never 'live'", () => {
  assert.deepEqual(roomState("2026-11-20", NOW), { state: "upcoming", daysAway: 22 });
  assert.deepEqual(roomState("2026-11-05", NOW), { state: "this_week", daysAway: 7 });
  assert.deepEqual(roomState("2026-10-29", NOW), { state: "results_day", daysAway: 0 });
  assert.deepEqual(roomState("2026-10-20", NOW), { state: "results_due", daysAway: -9 });
  assert.deepEqual(roomState("2026-10-01", NOW), { state: "archived", daysAway: -28 });
  // 20:00 UTC on 28 Oct is already 29 Oct in India.
  assert.equal(istDay(Date.parse("2026-10-28T20:00:00Z")), "2026-10-29");
  assert.equal(roomState("2026-10-29", Date.parse("2026-10-28T20:00:00Z")).state, "results_day");
});

test("one room per listing and meeting date; only mapped results meetings", () => {
  const rooms = roomsFrom(
    [
      event({}),
      event({ sourceUrl: "https://nsearchives.nseindia.com/corporate/xbrl/PRIOR_INTIMATION_1.xml" }), // same meeting, XBRL copy
      event({ purpose: "Financial Results/Dividend" }), // same meeting, other wording
      event({ kind: "board_meeting", symbol: "PATELENG", purpose: "Board Meeting Intimation" }),
      event({ mapped: false, symbol: null, isin: null, unmappedReason: "not_listed", company: "Gajanand International Limited" }),
      event({ kind: "dividend", source: "nse_corporate_actions" }),
    ],
    NOW
  );
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].symbol, "RICOAUTO");
  assert.equal(roomHref(rooms[0]), "/earnings/RICOAUTO/2026-11-06");
});

test("listing and opening rooms read from the event store; a bad date finds nothing", async () => {
  const stored = [event({}), event({ symbol: "OLDCO", eventDate: "2026-10-01", company: "Old Co Limited" })];
  const store: MarketEventStore = {
    insertNew: async () => 0,
    list: async ({ symbol, from, to }) => stored.filter((e) => (!symbol || e.symbol === symbol) && e.eventDate! >= from && e.eventDate! <= to),
  };
  const rooms = await listRooms(store, NOW, async () => {});
  assert.deepEqual(rooms.map((r) => r.symbol), ["RICOAUTO"]);
  assert.equal((await getRoom(store, "RICOAUTO", "2026-11-06", NOW))?.state, "upcoming");
  assert.equal(await getRoom(store, "RICOAUTO", "2026-11-07", NOW), null);
  assert.equal(await getRoom(store, "RICOAUTO", "../etc", NOW), null);
});
