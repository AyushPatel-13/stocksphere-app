import { test } from "node:test";
import assert from "node:assert/strict";

import type { MarketEvent } from "../../markets/eventIngest";
import { MACRO_EVENTS } from "../calendar";
import { buildImpactMap, macroInWindow } from "../map";

const nse = (patch: Partial<MarketEvent>): MarketEvent => ({
  id: "e1",
  source: "nse_corporate_actions",
  kind: "dividend",
  company: "Crisil Limited",
  mapped: true,
  unmappedReason: null,
  symbol: "CRISIL",
  isin: "INE007A01025",
  exchange: "NSE",
  purpose: "INTERIM DIVIDEND - RS 16 PER SHARE",
  eventDate: "2026-11-04",
  recordDate: "2026-11-04",
  publishedAt: null,
  sourceUrl: "https://www.nseindia.com/companies-listing/corporate-filings-actions",
  ...patch,
});

const MAP = buildImpactMap({
  macro: macroInWindow("2026-10-29", "2026-12-28"),
  market: [
    nse({}),
    nse({ id: "e2", source: "nse_board_meetings", kind: "results", symbol: "RICOAUTO", company: "Rico Auto Industries Limited", purpose: "Financial Results", eventDate: "2026-11-06" }),
    nse({ id: "e3", mapped: false, symbol: null, isin: null, unmappedReason: "not_listed", company: "Gajanand International Limited" }),
    nse({ id: "e4", source: "nse_board_meetings", kind: "board_meeting", symbol: "PATELENG", purpose: "Board Meeting Intimation" }),
  ],
});

test("the central-bank calendar holds only the sourced meetings, each with its source", () => {
  assert.deepEqual(macroInWindow("2026-10-29", "2026-12-28").map((e) => e.id), ["fomc-2026-12-09", "rbi-2026-12-04"]);
  for (const event of MACRO_EVENTS) {
    assert.match(event.source.url, /^https:\/\/www\.(federalreserve\.gov|rbi\.org\.in)\//);
    assert.ok(event.start <= event.end);
    assert.equal(event.timeZone, event.kind === "fomc" ? "ET" : "IST");
  }
});

test("every link has a reason and a source; unmapped and plain board meetings aren't linked", () => {
  assert.ok(MAP.links.length > 0);
  for (const link of MAP.links) {
    assert.ok(link.reason.trim().length > 10, link.targetId);
    assert.match(link.source.url, /^https:\/\//);
    assert.ok(MAP.events.some((e) => e.id === link.eventId));
    assert.ok(MAP.targets.some((t) => t.id === link.targetId));
  }
  assert.ok(!MAP.targets.some((t) => t.label === "PATELENG"));
  assert.ok(!MAP.links.some((l) => l.reason.includes("Gajanand")));
});

test("an inference is never shown as a fact, and isn't worded as a cause or forecast", () => {
  for (const link of MAP.links) {
    const target = MAP.targets.find((t) => t.id === link.targetId)!;
    // Facts are only company links from NSE; sectors are only inferences.
    assert.equal(link.kind === "fact", target.kind === "company");
    if (link.kind === "inference") assert.doesNotMatch(link.reason, /\b(will|causes?|because|leads? to|drives?|boosts?|hurts?)\b/i);
  }
  assert.equal(MAP.links.find((l) => l.targetId === "company-CRISIL")?.source.url, "https://www.nseindia.com/companies-listing/corporate-filings-actions");
});

test("dates carry their own time zone: ET for the Fed, IST for RBI and NSE; ordered by date", () => {
  const fed = MAP.events.find((e) => e.id === "fomc-2026-12-09")!;
  const rbi = MAP.events.find((e) => e.id === "rbi-2026-12-04")!;
  assert.match(fed.dateLabel, /\(ET\); decision time not given$/);
  assert.match(rbi.dateLabel, /\(IST\); decision time not given$/);
  assert.match(MAP.events.find((e) => e.title.startsWith("CRISIL"))!.dateLabel, /\(IST\)$/);
  const dates = MAP.events.map((e) => e.date);
  assert.deepEqual(dates, [...dates].sort());
  // A results meeting links to its earnings room.
  assert.equal(MAP.targets.find((t) => t.id === "company-RICOAUTO")?.href, "/earnings/RICOAUTO/2026-11-06");
});
