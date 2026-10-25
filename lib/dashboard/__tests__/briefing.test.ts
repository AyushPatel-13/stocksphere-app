import { test } from "node:test";
import assert from "node:assert/strict";

import { buildBriefing, type BriefingInput } from "../briefing";

const money = (amount: number, currency: string) => `${currency} ${amount.toFixed(2)}`;

const empty: BriefingInput = {
  breadth: null,
  topGainer: null,
  topLoser: null,
  watchlist: [],
  portfolio: [],
  unpricedHoldings: 0,
  openIpos: 0,
  earningsThisWeek: [],
};

test("no data gives no lines, never a placeholder", () => {
  assert.deepEqual(buildBriefing(empty, money), []);
});

test("breadth, movers and watchlist are described from the numbers given", () => {
  const lines = buildBriefing(
    {
      ...empty,
      breadth: { universe: "NIFTY 50", advancing: 14, declining: 37, unchanged: 0 },
      topGainer: { symbol: "ETERNAL", changePercent: 4.25 },
      topLoser: { symbol: "ADANIENT", changePercent: -2.86 },
      watchlist: [
        { symbol: "TCS", changePercent: 1.2 },
        { symbol: "INFY", changePercent: -0.5 },
        { symbol: "XYZ", changePercent: null },
      ],
    },
    money
  );
  assert.deepEqual(lines, [
    "NIFTY 50 was broadly down in the latest session: 14 advancing, 37 declining.",
    "ETERNAL led (+4.25%) and ADANIENT lagged (−2.86%).",
    "Your watchlist: 1 up, 1 down. Best TCS (+1.20%), weakest INFY (−0.50%).",
  ]);
});

test("portfolio day change is shown per currency, and only when every holding is priced", () => {
  const portfolio = [
    { currency: "INR", dayChange: -1234.5, dayChangePercent: -0.8 },
    { currency: "USD", dayChange: null, dayChangePercent: null },
  ];
  assert.deepEqual(buildBriefing({ ...empty, portfolio }, money), [
    "Your INR holdings moved −INR 1234.50 (−0.80%) on the day.",
  ]);
  assert.deepEqual(buildBriefing({ ...empty, portfolio, unpricedHoldings: 1 }, money), []);
});

test("events lines appear only when there are events", () => {
  const lines = buildBriefing({ ...empty, openIpos: 1, earningsThisWeek: ["AAPL", "MSFT"] }, money);
  assert.deepEqual(lines, ["Earnings coming up for AAPL, MSFT.", "1 IPO is open for subscription."]);
});

test("the F&O ban line names the member's banned stocks and the trade date, and only when there are some", () => {
  assert.deepEqual(buildBriefing({ ...empty, foBan: { tradeDate: "2026-10-26", symbols: ["SAIL"] } }, money), [
    "In NSE's F&O ban for 2026-10-26: SAIL (no new F&O positions until it exits).",
  ]);
  assert.deepEqual(buildBriefing({ ...empty, foBan: { tradeDate: "2026-10-26", symbols: [] } }, money), []);
  assert.deepEqual(buildBriefing({ ...empty, foBan: null }, money), []);
});
