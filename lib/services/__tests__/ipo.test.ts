import { test } from "node:test";
import assert from "node:assert/strict";

import {
  boardOf,
  parseClock,
  parseIsoDate,
  parsePriceBand,
  parseSubscription,
  parseUpstoxIpo,
  parseUpstoxIpoDetail,
  parseUpstoxIpoList,
  positiveInt,
  positiveNumber,
} from "../ipoParse";
import {
  changePct,
  daysBetween,
  demandLevel,
  headlineMentions,
  indiaDateKey,
  ipoSection,
  listingSession,
  matchGmpRow,
  minInvestment,
  nameTokens,
  newsPhrase,
  percentOf,
} from "../ipoMetrics";
import {
  GMP_UNAVAILABLE_REASON,
  buildIpoBoard,
  buildIpoNews,
  clearIpoCache,
  getIpoBoard,
  listingStateOf,
  upstoxRowsToCandles,
  type IpoDeps,
} from "../ipo";
import type { UpstoxResult } from "../../apis/upstox";
import { GET } from "@/app/api/ipo/route";

/* ------------------------------------------------------------ section classification */

const WINDOW = { openDate: "2026-10-21", closeDate: "2026-10-23" };

test("ipoSection: upcoming before the window, open on both boundary days, closed after", () => {
  assert.deepEqual(ipoSection(WINDOW, "2026-10-20"), { section: "upcoming", reason: null });
  assert.deepEqual(ipoSection(WINDOW, "2026-10-21"), { section: "open", reason: null }); // opens today
  assert.deepEqual(ipoSection(WINDOW, "2026-10-22"), { section: "open", reason: null });
  assert.deepEqual(ipoSection(WINDOW, "2026-10-23"), { section: "open", reason: null }); // closes today
  assert.deepEqual(ipoSection(WINDOW, "2026-10-24"), { section: "closed", reason: null });
  // A one-day window is open on that day only.
  assert.equal(ipoSection({ openDate: "2026-10-21", closeDate: "2026-10-21" }, "2026-10-21").section, "open");
  assert.equal(ipoSection({ openDate: "2026-10-21", closeDate: "2026-10-21" }, "2026-10-22").section, "closed");
});

test("ipoSection: missing or inconsistent dates give no section and say why", () => {
  assert.deepEqual(ipoSection({ openDate: null, closeDate: null }, "2026-10-20"), { section: null, reason: "Subscription dates not announced" });
  assert.deepEqual(ipoSection({ openDate: null, closeDate: "2026-10-23" }, "2026-10-20"), { section: null, reason: "Subscription start date not announced" });
  assert.deepEqual(ipoSection({ openDate: "2026-10-21", closeDate: null }, "2026-10-22"), { section: null, reason: "Subscription end date not announced" });
  assert.equal(ipoSection({ openDate: "2026-10-23", closeDate: "2026-10-21" }, "2026-10-22").section, null);
});

test("indiaDateKey: classification uses the Indian date, not UTC", () => {
  // 20 Oct 18:29 UTC = 20 Oct 23:59 IST → still upcoming for a 21 Oct opening.
  const lateEvening = indiaDateKey(Date.UTC(2026, 9, 20, 18, 29));
  assert.equal(lateEvening, "2026-10-20");
  assert.equal(ipoSection(WINDOW, lateEvening).section, "upcoming");
  // 20 Oct 18:30 UTC = 21 Oct 00:00 IST → opens today.
  const midnight = indiaDateKey(Date.UTC(2026, 9, 20, 18, 30));
  assert.equal(midnight, "2026-10-21");
  assert.equal(ipoSection(WINDOW, midnight).section, "open");
  assert.equal(daysBetween("2026-09-20", "2026-10-20"), 30);
});

/* ------------------------------------------------------------ parsing primitives */

test("parseIsoDate / parseClock reject anything but real values", () => {
  assert.equal(parseIsoDate("2026-10-21"), "2026-10-21");
  assert.equal(parseIsoDate("2026-02-30"), null);
  assert.equal(parseIsoDate("21-10-2026"), null);
  assert.equal(parseIsoDate(null), null);
  assert.equal(parseClock("10:00:00"), "10:00");
  assert.equal(parseClock("17:00"), "17:00");
  assert.equal(parseClock("25:00:00"), null);
});

test("numbers: Upstox's 0 means not announced; junk is null", () => {
  assert.equal(positiveNumber(0), null);
  assert.equal(positiveNumber("41.5"), 41.5);
  assert.equal(positiveNumber(-1), null);
  assert.equal(positiveNumber("abc"), null);
  assert.equal(positiveInt(1200), 1200);
  assert.equal(positiveInt(12.5), null);
  assert.deepEqual(parsePriceBand(660, 693), { low: 660, high: 693 });
  assert.deepEqual(parsePriceBand(83, 83), { low: 83, high: 83 });
  assert.equal(parsePriceBand(0, 0), null);
  assert.equal(parsePriceBand(null, 693), null);
  assert.equal(parsePriceBand(700, 600), null);
  assert.equal(parseSubscription("96.63"), 96.63);
  assert.equal(parseSubscription("0.0"), 0);
  assert.equal(parseSubscription(null), null);
  assert.equal(parseSubscription("n/a"), null);
  assert.equal(boardOf("regular"), "mainboard");
  assert.equal(boardOf("sme"), "sme");
  assert.equal(boardOf("debt"), null);
});

/* ------------------------------------------------------------ Upstox responses (shapes from the docs and live probes) */

const ITEM = (over: Record<string, unknown> = {}) => ({
  id: "paras-healthcare-limited-ipo",
  symbol: "PARASHLTH",
  name: "Paras Healthcare IPO",
  status: "open",
  isin: "INE0PH001012",
  issue_type: "regular",
  issue_size: 1450,
  industry: "Hospital & Healthcare Services",
  minimum_price: 660,
  maximum_price: 693,
  bidding_start_date: "2026-10-21",
  bidding_end_date: "2026-10-23",
  total_subscription: "0.0",
  ...over,
});

const LIST = (data: unknown[], page = 1, totalPages = 1) => ({
  status: "success",
  data,
  meta_data: { page: { page_number: page, total_pages: totalPages, records: data.length, total_records: data.length } },
});

const DETAIL = (over: Record<string, unknown> = {}, timeline: Record<string, unknown> = {}) => ({
  status: "success",
  data: {
    ...ITEM(),
    daily_start_time: "10:00:00",
    daily_end_time: "17:00:00",
    face_value: 1,
    tick_size: null,
    lot_size: 21,
    minimum_quantity: 21,
    cut_off_price: 693,
    listing_price: null,
    listing_exchange: "BSE,NSE",
    rhp_url: "https://example.com/rhp.pdf",
    drhp_url: "javascript:alert(1)",
    timeline: {
      application_start_date: "2026-10-21",
      application_end_date: "2026-10-23",
      allotment_date: "2026-10-27",
      refund_initiation_date: "2026-10-28",
      listing_date: "2026-10-28",
      mandate_end_date: "2026-12-01",
      ...timeline,
    },
    total_subscription: null,
    ...over,
  },
});

test("parseUpstoxIpo: normalises a list item; drops items without id, name or known type", () => {
  const ipo = parseUpstoxIpo(ITEM())!;
  assert.equal(ipo.board, "mainboard");
  assert.equal(ipo.issueSizeCr, 1450);
  assert.deepEqual(ipo.priceBand, { low: 660, high: 693 });
  assert.equal(ipo.openDate, "2026-10-21");
  assert.equal(ipo.providerStatus, "open");
  // Announced-but-undated issues, exactly as Upstox sends them.
  const undated = parseUpstoxIpo(ITEM({ symbol: null, isin: null, issue_size: null, minimum_price: null, maximum_price: null, bidding_start_date: null, bidding_end_date: null }))!;
  assert.equal(undated.symbol, null);
  assert.equal(undated.priceBand, null);
  assert.equal(undated.openDate, null);
  assert.equal(parseUpstoxIpo(ITEM({ id: "" })), null);
  assert.equal(parseUpstoxIpo(ITEM({ issue_type: "bond" })), null);
});

test("parseUpstoxIpoList: success envelope required; paging read when present", () => {
  const parsed = parseUpstoxIpoList(LIST([ITEM(), { junk: true }], 1, 6))!;
  assert.equal(parsed.items.length, 1);
  assert.deepEqual(parsed.page, { pageNumber: 1, totalPages: 6 });
  assert.equal(parseUpstoxIpoList({ status: "error", errors: [] }), null);
  assert.equal(parseUpstoxIpoList(null), null);
  assert.equal(parseUpstoxIpoList({ status: "success", data: {} }), null);
});

test("parseUpstoxIpoDetail: timeline, lot, exchanges; unsafe URLs dropped; dates fall back to the timeline", () => {
  const d = parseUpstoxIpoDetail(DETAIL())!;
  assert.equal(d.lotSize, 21);
  assert.equal(d.minimumQuantity, 21);
  assert.equal(d.cutOffPrice, 693);
  assert.equal(d.listingPrice, null);
  assert.deepEqual(d.listingExchanges, ["BSE", "NSE"]);
  assert.equal(d.dailyStartTime, "10:00");
  assert.equal(d.rhpUrl, "https://example.com/rhp.pdf");
  assert.equal(d.drhpUrl, null);
  assert.equal(d.timeline.allotmentDate, "2026-10-27");
  assert.equal(d.timeline.listingDate, "2026-10-28");
  assert.equal(d.totalSubscription, null);
  const fromTimeline = parseUpstoxIpoDetail(DETAIL({ bidding_start_date: null, bidding_end_date: null }))!;
  assert.equal(fromTimeline.openDate, "2026-10-21");
  assert.equal(fromTimeline.closeDate, "2026-10-23");
  assert.equal(parseUpstoxIpoDetail({ status: "error", errors: [{ errorCode: "UDAPI100500" }] }), null);
});

/* ------------------------------------------------------------ metrics */

test("demandLevel: stated bands from the overall multiple; nothing before bidding opens", () => {
  assert.equal(demandLevel("upcoming", 0.42).level, "not-open");
  assert.equal(demandLevel("open", null).level, "no-data");
  assert.equal(demandLevel("open", 0).level, "undersubscribed");
  assert.equal(demandLevel("open", 1).level, "subscribed");
  assert.equal(demandLevel("closed", 9.99).level, "subscribed");
  assert.equal(demandLevel("closed", 10).level, "strong");
  assert.equal(demandLevel("closed", 50).level, "very-strong");
  assert.match(demandLevel("closed", 96.63).basis, /96\.63× overall \(Upstox\)/);
});

test("money arithmetic: minimum quantity × upper band; nulls propagate", () => {
  assert.equal(minInvestment(21, { low: 660, high: 693 }), 14553);
  assert.equal(minInvestment(null, { low: 660, high: 693 }), null);
  assert.equal(minInvestment(21, null), null);
  assert.equal(changePct(80, 82)?.toFixed(2), "-2.44");
  assert.equal(changePct(80, null), null);
  assert.equal(percentOf(260, 1119)?.toFixed(2), "23.24");
  assert.equal(percentOf(260, 0), null);
});

test("listingSession and Upstox candle rows", () => {
  const candles = upstoxRowsToCandles([
    ["2026-10-13T00:00:00+05:30", 72.2, 72.2, 72.2, 72.2, 6400, 0],
    ["2026-10-12T00:00:00+05:30", 80, 80, 76, 76, 488000, 0],
    ["bad"],
  ]);
  assert.equal(candles.length, 2);
  assert.deepEqual(listingSession("2026-10-12", candles), { listingDayClose: 76, latestClose: 72.2, latestDate: "2026-10-13" });
  assert.equal(listingSession("2026-10-14", candles), null);
  assert.equal(listingSession(null, candles), null);
});

test("listingStateOf: listed when price, date or Upstox say so; unknown without details", () => {
  assert.equal(listingStateOf(80, null, "closed", true, "2026-10-20"), "listed");
  assert.equal(listingStateOf(null, "2026-10-20", "closed", true, "2026-10-20"), "listed");
  assert.equal(listingStateOf(null, "2026-10-23", "closed", true, "2026-10-20"), "awaiting");
  assert.equal(listingStateOf(null, null, "listed", false, "2026-10-20"), "listed");
  assert.equal(listingStateOf(null, null, "closed", false, "2026-10-20"), null);
});

test("names, news phrases and the optional GMP matcher", () => {
  assert.deepEqual(nameTokens("Tonbo Imaging India Limited IPO"), ["tonbo", "imaging"]);
  assert.equal(newsPhrase("Reliance Jio IPO"), "reliance jio");
  assert.equal(newsPhrase("Zepto"), "zepto");
  assert.equal(newsPhrase("ABC IPO"), null);
  assert.equal(headlineMentions("Reliance Jio IPO: anchor book closes", "reliance jio"), true);
  assert.equal(headlineMentions("Jio Financial shares fall", "reliance jio"), false);
  const rows = [{ name: "Paras Healthcare", board: "mainboard" as const, gmp: 50, priceUpper: 693 }];
  assert.equal(matchGmpRow({ name: "Paras Healthcare IPO", board: "mainboard", priceUpper: 693 }, rows)?.gmp, 50);
  assert.equal(matchGmpRow({ name: "Paras Healthcare IPO", board: "sme", priceUpper: 693 }, rows), null);
  assert.equal(matchGmpRow({ name: "Paras Healthcare IPO", board: "mainboard", priceUpper: 700 }, rows), null);
});

/* ------------------------------------------------------------ service */

const ok = (body: unknown): UpstoxResult => ({ ok: true, body });

const LISTS: Record<string, unknown[]> = {
  open: [ITEM()], // Upstox says "open" the evening before bidding starts
  upcoming: [
    ITEM({ id: "core4-ipo", symbol: null, name: "Core4 Engineers IPO", status: "upcoming", issue_type: "sme", bidding_start_date: "2026-10-23", bidding_end_date: "2026-10-27" }),
    ITEM({ id: "flipkart-ipo", symbol: null, name: "Flipkart IPO", status: "upcoming", minimum_price: null, maximum_price: null, bidding_start_date: null, bidding_end_date: null, total_subscription: "0.0" }),
  ],
  closed: [ITEM({ id: "tonbo-ipo", symbol: "TONBO", name: "Tonbo Imaging India IPO", status: "closed", bidding_start_date: "2026-10-15", bidding_end_date: "2026-10-19", total_subscription: "96.63" })],
  listed: [
    ITEM({ id: "rkfal-ipo", symbol: "RKFAL", name: "R.K.Fashion Accessories IPO", status: "listed", isin: "INE2O2Y01016", issue_type: "sme", minimum_price: 77, maximum_price: 82, bidding_start_date: "2026-10-05", bidding_end_date: "2026-10-07", total_subscription: "2.72" }),
    ITEM({ id: "old-ipo", name: "Old Listing IPO", status: "listed", bidding_start_date: "2026-08-01", bidding_end_date: "2026-08-05" }),
  ],
};

const DETAILS: Record<string, unknown> = {
  "paras-healthcare-limited-ipo": DETAIL(),
  "core4-ipo": DETAIL({ id: "core4-ipo", symbol: null, name: "Core4 Engineers IPO", status: "upcoming", issue_type: "sme", bidding_start_date: "2026-10-23", bidding_end_date: "2026-10-27", lot_size: 1200, minimum_quantity: 1200, total_subscription: "0.42" }),
  "tonbo-ipo": DETAIL({ id: "tonbo-ipo", symbol: "TONBO", name: "Tonbo Imaging India IPO", status: "closed", bidding_start_date: "2026-10-15", bidding_end_date: "2026-10-19", cut_off_price: 700, total_subscription: "96.63" }, { listing_date: "2026-10-23" }),
  "rkfal-ipo": DETAIL(
    { id: "rkfal-ipo", symbol: "RKFAL", name: "R.K.Fashion Accessories IPO", status: "listed", isin: "INE2O2Y01016", issue_type: "sme", minimum_price: 77, maximum_price: 82, bidding_start_date: "2026-10-05", bidding_end_date: "2026-10-07", lot_size: 1600, minimum_quantity: 3200, cut_off_price: 82, listing_price: 80, listing_exchange: "NSE", total_subscription: "2.72" },
    { listing_date: "2026-10-12" }
  ),
};

function deps(over: Partial<IpoDeps> = {}): IpoDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    listIpos: async ({ status }) => {
      calls.push(`list:${status}`);
      return ok(LIST(LISTS[status] ?? []));
    },
    ipoDetail: async (id) => {
      calls.push(`detail:${id}`);
      return id in DETAILS ? ok(DETAILS[id]) : { ok: false, code: "not_found", status: 400 };
    },
    getCandles: async (key) => {
      calls.push(`candles:${key}`);
      return [
        ["2026-10-19T00:00:00+05:30", 70, 70, 68, 68.6, 1000, 0],
        ["2026-10-12T00:00:00+05:30", 80, 80, 76, 76, 488000, 0],
      ];
    },
    getGmp: null,
    fetchText: async () => null,
    // 20 Oct 2026, 21:30 IST
    now: () => Date.UTC(2026, 9, 20, 16, 0),
    sleep: async () => {},
    ...over,
  };
}

test("buildIpoBoard: sections from dates (not Upstox's status), undated issues set aside with the reason", async () => {
  clearIpoCache();
  const result = await buildIpoBoard(deps());
  assert.ok(result.ok);
  const board = result.data;
  assert.equal(board.today, "2026-10-20");
  const section = Object.fromEntries(board.ipos.map((r) => [r.id, r.section]));
  assert.deepEqual(section, { "paras-healthcare-limited-ipo": "upcoming", "core4-ipo": "upcoming", "tonbo-ipo": "closed", "rkfal-ipo": "closed" });
  assert.equal(board.ipos.find((r) => r.id === "paras-healthcare-limited-ipo")!.providerStatus, "open");
  assert.deepEqual(board.unclassified, [{ id: "flipkart-ipo", name: "Flipkart IPO", board: "mainboard", providerStatus: "upcoming", reason: "Subscription dates not announced" }]);
  assert.ok(!board.ipos.some((r) => r.id === "old-ipo"), "closed more than 30 days ago");
});

test("buildIpoBoard: fields, money, listing and no fake subscription before bidding", async () => {
  clearIpoCache();
  const d = deps();
  const result = await buildIpoBoard(d);
  assert.ok(result.ok);
  const by = Object.fromEntries(result.data.ipos.map((r) => [r.id, r]));

  const paras = by["paras-healthcare-limited-ipo"];
  assert.equal(paras.lotSize, 21);
  assert.equal(paras.minInvestment, 14553);
  assert.equal(paras.issueSizeCr, 1450);
  assert.equal(paras.subscription, null);
  assert.equal(paras.demand.level, "not-open");
  assert.equal(paras.timeline?.allotmentDate, "2026-10-27");
  // Upstox reports 0.42 for an issue that has not opened: not shown.
  assert.equal(by["core4-ipo"].subscription, null);

  const tonbo = by["tonbo-ipo"];
  assert.equal(tonbo.subscription, 96.63);
  assert.equal(tonbo.demand.level, "very-strong");
  assert.equal(tonbo.listingState, "awaiting");
  assert.equal(tonbo.session, null);

  const rk = by["rkfal-ipo"];
  assert.equal(rk.listingState, "listed");
  assert.equal(rk.listingPrice, 80);
  assert.equal(rk.listingGainPct?.toFixed(2), "-2.44");
  assert.equal(rk.minInvestment, 3200 * 82);
  assert.equal(rk.session?.listingDayClose, 76);
  assert.equal(rk.session?.latestClose, 68.6);
  assert.ok(d.calls.includes("candles:NSE_EQ|INE2O2Y01016"));

  // No GMP provider: GMP is unavailable with the reason, never 0.
  assert.equal(result.data.gmp.available, false);
  assert.equal(result.data.gmp.reason, GMP_UNAVAILABLE_REASON);
  assert.ok(result.data.ipos.every((r) => r.gmp === null));
});

test("buildIpoBoard: a GMP provider, when configured, is matched and kept apart", async () => {
  clearIpoCache();
  const result = await buildIpoBoard(
    deps({ getGmp: async () => ({ providerName: "Licensed GMP", providerUrl: "https://example.com", updatedAt: "2026-10-20T10:00:00.000Z", rows: [{ name: "Paras Healthcare", board: "mainboard", gmp: 50, priceUpper: 693 }] }) })
  );
  assert.ok(result.ok);
  const paras = result.data.ipos.find((r) => r.id === "paras-healthcare-limited-ipo")!;
  assert.equal(paras.gmp?.value, 50);
  assert.equal(paras.gmp?.pctOfUpper?.toFixed(2), "7.22");
  assert.equal(result.data.gmp.available, true);
});

test("buildIpoBoard: expired token or missing config → typed error; one failed status → partial board", async () => {
  clearIpoCache();
  const expired = await buildIpoBoard(deps({ listIpos: async () => ({ ok: false, code: "auth", status: 401 }) }));
  assert.equal(expired.ok, false);
  assert.equal(!expired.ok && expired.code, "auth");
  assert.match(!expired.ok ? expired.message : "", /expired/);

  clearIpoCache();
  const none = await buildIpoBoard(deps({ listIpos: async () => ({ ok: false, code: "not_configured", status: null }) }));
  assert.equal(!none.ok && none.code, "not_configured");

  clearIpoCache();
  const base = deps();
  const partial = await buildIpoBoard(
    deps({ listIpos: async (p) => (p.status === "listed" ? { ok: false, code: "rate_limited", status: 429 } : base.listIpos(p)) })
  );
  assert.ok(partial.ok);
  assert.equal(partial.data.sources.find((s) => s.id === "upstox-list")?.ok, false);
  assert.ok(!partial.data.ipos.some((r) => r.id === "rkfal-ipo"));
});

test("buildIpoBoard: a rate-limited details call is retried once, then list fields are used", async () => {
  clearIpoCache();
  const base = deps();
  let tonboCalls = 0;
  const result = await buildIpoBoard(
    deps({
      ipoDetail: async (id) => {
        if (id === "tonbo-ipo") {
          tonboCalls++;
          return { ok: false, code: "rate_limited", status: 429 };
        }
        return base.ipoDetail(id);
      },
    })
  );
  assert.ok(result.ok);
  assert.equal(tonboCalls, 2);
  const tonbo = result.data.ipos.find((r) => r.id === "tonbo-ipo")!;
  assert.equal(tonbo.detailOk, false);
  assert.equal(tonbo.lotSize, null);
  assert.equal(tonbo.subscription, 96.63); // from the list
  assert.equal(tonbo.listingState, null); // unknown, not guessed
  assert.match(result.data.sources.find((s) => s.id === "upstox-detail")?.note ?? "", /rate_limited ×1/);
});

test("buildIpoBoard: listed pages stop once a page is older than the window", async () => {
  clearIpoCache();
  const pages: number[] = [];
  const base = deps();
  await buildIpoBoard(
    deps({
      listIpos: async (p) => {
        if (p.status !== "listed") return base.listIpos(p);
        pages.push(p.pageNumber ?? 1);
        return ok(LIST(LISTS.listed, p.pageNumber, 6));
      },
    })
  );
  assert.deepEqual(pages, [1]);
});

test("getIpoBoard: caches; serves the last good board flagged stale on a provider error, never on a token error", async () => {
  clearIpoCache();
  let t = Date.UTC(2026, 9, 20, 16, 0);
  let mode: "ok" | "timeout" | "auth" = "ok";
  const base = deps();
  const d = deps({
    now: () => t,
    listIpos: async (p) => (mode === "ok" ? base.listIpos(p) : { ok: false, code: mode, status: null }),
  });
  assert.ok((await getIpoBoard(d)).ok);
  mode = "timeout";
  t += 3 * 60_000;
  const stale = await getIpoBoard(d);
  assert.ok(stale.ok && stale.data.staleReason);
  mode = "auth";
  t += 3 * 60_000;
  const auth = await getIpoBoard(d);
  assert.equal(auth.ok, false);
});

/* ------------------------------------------------------------ news */

test("buildIpoNews: per-issue matches by id, 7-day counts, IPO filter, dead feed flagged", () => {
  const rss = (items: [string, string, string][]) =>
    `<rss><channel>${items.map(([t, l, d]) => `<item><title>${t}</title><link>${l}</link><pubDate>${d}</pubDate></item>`).join("")}</channel></rss>`;
  const news = buildIpoNews(
    [
      { id: "et", name: "ET", url: "u1", ipoOnly: true, xml: rss([["Reliance Jio IPO opens", "https://a/1", "Tue, 20 Oct 2026 09:00:00 +0530"], ["Reliance Jio IPO GMP", "https://a/2", "Tue, 06 Oct 2026 09:00:00 +0530"]]) },
      { id: "bs", name: "BS", url: "u2", ipoOnly: false, xml: rss([["Sensex falls", "https://b/1", "Tue, 20 Oct 2026 10:00:00 +0530"], ["Tonbo Imaging lists today", "https://b/2", "Tue, 20 Oct 2026 08:00:00 +0530"]]) },
      { id: "x", name: "Dead", url: "u3", ipoOnly: false, xml: null },
    ],
    [{ id: "jio", name: "Reliance Jio IPO" }, { id: "tonbo", name: "Tonbo Imaging India IPO" }],
    Date.UTC(2026, 9, 20, 10, 0)
  );
  assert.equal(news.byId.jio.length, 2);
  assert.equal(news.weekCount.jio, 1);
  assert.equal(news.weekCount.tonbo, 1);
  assert.deepEqual(news.items.map((i) => i.title), ["Reliance Jio IPO opens", "Reliance Jio IPO GMP"]);
  assert.equal(news.sources.find((s) => s.id === "x")?.ok, false);
});

/* ------------------------------------------------------------ route */

test("GET /api/ipo: 200 with data, 503 with code and message on provider errors, 500 on throw", async () => {
  clearIpoCache();
  const board = await buildIpoBoard(deps());
  const res = await GET(undefined, undefined, async () => board);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.ipos));
  assert.ok(!JSON.stringify(body).includes("Bearer"));

  const expired = await GET(undefined, undefined, async () => ({ ok: false, code: "auth", message: "token expired" }));
  assert.equal(expired.status, 503);
  assert.deepEqual(await expired.json(), { success: false, code: "auth", error: "token expired" });

  const boom = await GET(undefined, undefined, async () => {
    throw new Error("x");
  });
  assert.equal(boom.status, 500);
});
