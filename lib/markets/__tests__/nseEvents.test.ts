import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { clearNseEquityMasterCache, getNseEquityMaster, parseNseEquityMaster, type NseListing } from "../../apis/nseEquityMaster";
import {
  corporateActionKind,
  indexNseMaster,
  mapNseEvent,
  normaliseCompanyName,
  nseDate,
  nseTimestamp,
  parseBoardMeetings,
  parseCorporateActions,
  symbolFromFilingLink,
} from "../nseEvents";

// Recorded from NSE on 29 Oct 2026 (06:03 UTC). The equity list is trimmed to
// the companies in the two feeds plus a few others; the feeds are unedited.
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const MASTER = parseNseEquityMaster(fixture("nse-equity-master-subset-2026-10-29.csv"))!;
const ACTIONS = parseCorporateActions(fixture("nse-corporate-actions-2026-10-29.xml"));
const MEETINGS = parseBoardMeetings(fixture("nse-board-meetings-2026-10-29.xml"));
const INDEX = indexNseMaster(MASTER);

const listing = (symbol: string, name: string, isin: string): NseListing => ({ symbol, name, series: "EQ", isin, listedOn: null });

test("the equity list parses symbol, full name, series, ISIN and listing date", () => {
  const ador = MASTER.find((row) => row.symbol === "ADOR");
  assert.deepEqual(ador, { symbol: "ADOR", name: "Ador Welding Limited", series: "EQ", isin: "INE045A01017", listedOn: "1995-05-10" });
  assert.equal(MASTER.length, 29);
});

test("the equity list refuses a file in another shape, and skips rows without a valid ISIN", () => {
  assert.equal(parseNseEquityMaster("<html>Access denied</html>"), null);
  assert.equal(parseNseEquityMaster(""), null);
  const rows = parseNseEquityMaster(
    [
      "SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE",
      'ACME,"Acme, Brakes & Co Limited",EQ,01-JAN-2020,10,1,INE000A01019,10',
      "BAD,Bad Row Limited,EQ,01-JAN-2020,10,1,NOT-AN-ISIN,10",
    ].join("\n")
  );
  assert.deepEqual(rows?.map((row) => [row.symbol, row.name]), [["ACME", "Acme, Brakes & Co Limited"]]);
});

test("the equity list is fetched once a day, and a failed or empty download isn't kept", async () => {
  clearNseEquityMasterCache();
  let calls = 0;
  const csv = fixture("nse-equity-master-subset-2026-10-29.csv");
  const ok = (async () => {
    calls++;
    return new Response(csv, { status: 200 });
  }) as typeof fetch;

  assert.equal((await getNseEquityMaster(ok, () => 0))?.length, 29);
  await getNseEquityMaster(ok, () => 60_000);
  assert.equal(calls, 1);

  clearNseEquityMasterCache();
  const down = (async () => new Response("", { status: 503 })) as typeof fetch;
  assert.equal(await getNseEquityMaster(down, () => 0), null);
  const empty = (async () => new Response("SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, ISIN NUMBER\n", { status: 200 })) as typeof fetch;
  assert.equal(await getNseEquityMaster(empty, () => 0), null);
  clearNseEquityMasterCache();
});

test("corporate actions: company, kind, ex-date, record date and IST publish time", () => {
  assert.equal(ACTIONS.length, 16);
  const genus = ACTIONS.find((a) => a.company === "Genus Power Infrastructures Limited");
  assert.equal(genus?.kind, "buyback");
  assert.equal(genus?.exDate, "2026-10-30");
  assert.equal(genus?.recordDate, "2026-10-30");
  assert.equal(genus?.series, "EQ");
  // Entities decoded once; nothing in the text is markup.
  assert.ok(ACTIONS.some((a) => a.company === "Central Mine Planning & Design Institute Limited"));
  for (const action of ACTIONS) {
    assert.ok(!/[<>]/.test(action.company + action.purpose), action.company);
    assert.match(action.publishedAt ?? "", /\+05:30$/);
  }
});

test("board meetings: purpose, results flag, meeting date and filing link", () => {
  assert.equal(MEETINGS.length, 20);
  const andhra = MEETINGS.find((m) => m.company === "The Andhra Sugars Limited");
  assert.equal(andhra?.purpose, "Financial Results");
  assert.equal(andhra?.results, true);
  assert.equal(andhra?.meetingDate, "2026-11-07");
  assert.equal(andhra?.publishedAt, "2026-10-29T11:28:15+05:30");
  assert.equal(MEETINGS.filter((m) => m.results).length > 0, true);
  assert.equal(MEETINGS.find((m) => m.purpose === "Board Meeting Intimation")?.results, false);
});

test("dates: NSE's DD-Mon-YYYY, with '-' and anything else as missing", () => {
  assert.equal(nseDate("04-Nov-2026"), "2026-11-04");
  assert.equal(nseDate("-"), null);
  assert.equal(nseDate("2026-11-04"), null);
  assert.equal(nseDate("31-Foo-2026"), null);
  assert.equal(nseTimestamp("29-Oct-2026 05:19:45"), "2026-10-29T05:19:45+05:30");
  assert.equal(nseTimestamp("Thu, 29 Oct 2026"), null);
});

test("corporate action kinds come from NSE's purpose text", () => {
  assert.equal(corporateActionKind("INTERIM DIVIDEND - RS 9.50 PER SHARE"), "dividend");
  assert.equal(corporateActionKind("BUY BACK"), "buyback");
  assert.equal(corporateActionKind("FACE VALUE SPLIT (SUB-DIVISION) - FROM RS 10/- PER SHARE TO RS 2/- PER SHARE"), "split");
  assert.equal(corporateActionKind("BONUS 1:1"), "bonus");
  assert.equal(corporateActionKind("RIGHTS 1:5 @ PREMIUM RS 90/-"), "rights");
  assert.equal(corporateActionKind("ANNUAL GENERAL MEETING"), "other");
});

test("the symbol in a filing's file name is read only from NSE's own archive", () => {
  assert.equal(symbolFromFilingLink("https://nsearchives.nseindia.com/corporate/RICOAUTO_29102026110542_RICOPriorIntimation06112026Signed.pdf"), "RICOAUTO");
  assert.equal(symbolFromFilingLink("https://nsearchives.nseindia.com/corporate/xbrl/PRIOR_INTIMATION_868_WebXMLFile_20261029_110847230.xml"), null);
  assert.equal(symbolFromFilingLink("https://evil.example/corporate/RICOAUTO_29102026110542_x.pdf"), null);
  assert.equal(symbolFromFilingLink("not a url"), null);
});

test("names compare equal across NSE files, ignoring case, punctuation and the legal form only", () => {
  assert.equal(normaliseCompanyName("SAGILITY LIMITED"), normaliseCompanyName("Sagility Ltd."));
  assert.equal(normaliseCompanyName("Central Mine Planning &amp; Design Institute Limited"), "central mine planning & design institute");
  assert.notEqual(normaliseCompanyName("Supreme Industries Limited"), normaliseCompanyName("Supreme Petrochem Limited"));
});

test("today's feeds map exactly: 16/16 corporate actions and 18/20 board meetings", () => {
  const actions = ACTIONS.map((a) => mapNseEvent(a, INDEX));
  assert.equal(actions.filter((m) => m.status === "mapped").length, 16);

  const meetings = MEETINGS.map((m) => ({ meeting: m, mapping: mapNseEvent(m, INDEX) }));
  assert.equal(meetings.filter(({ mapping }) => mapping.status === "mapped").length, 18);
  // The two that don't are an SME company, which isn't in the main-board list.
  const unmapped = meetings.filter(({ mapping }) => mapping.status === "unmapped");
  assert.deepEqual(unmapped.map(({ meeting }) => meeting.company), ["Gajanand International Limited", "Gajanand International Limited"]);
  assert.ok(unmapped.every(({ mapping }) => mapping.status === "unmapped" && mapping.reason === "not_listed"));

  const rico = meetings.find(({ meeting }) => meeting.link.includes("/RICOAUTO_"))?.mapping;
  assert.deepEqual(rico, { status: "mapped", symbol: "RICOAUTO", isin: rico?.status === "mapped" ? rico.isin : "", name: "Rico Auto Industries Limited", via: "filing" });
});

test("a mapping is never a guess: no near match, no pick between namesakes, no conflict", () => {
  const index = indexNseMaster([
    listing("SUPREMEIND", "Supreme Industries Limited", "INE195A01028"),
    listing("TWINA", "Twin Name Limited", "INE000A01011"),
    listing("TWINB", "Twin Name Ltd", "INE000B01019"),
  ]);
  // A different company with a similar name is not a match.
  assert.deepEqual(mapNseEvent({ company: "Supreme Petrochem Limited" }, index), { status: "unmapped", reason: "not_listed" });
  assert.deepEqual(mapNseEvent({ company: "Supreme Industries" }, index).status, "mapped");
  // Two listings with the same name: neither is chosen.
  assert.deepEqual(mapNseEvent({ company: "Twin Name Limited" }, index), { status: "unmapped", reason: "ambiguous" });
  // The file name says one company and the title another: refuse.
  assert.deepEqual(
    mapNseEvent({ company: "Twin Name Limited", link: "https://nsearchives.nseindia.com/corporate/SUPREMEIND_29102026110542_x.pdf" }, index),
    { status: "unmapped", reason: "conflict" }
  );
  // The file name is enough on its own when the title names nothing else.
  assert.equal(
    mapNseEvent({ company: "Unknown Name Limited", link: "https://nsearchives.nseindia.com/corporate/SUPREMEIND_29102026110542_x.pdf" }, index).status,
    "mapped"
  );
});
