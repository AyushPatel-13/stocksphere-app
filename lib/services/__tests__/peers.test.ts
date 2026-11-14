import { test } from "node:test";
import assert from "node:assert/strict";

import { GET } from "@/app/api/peers/route";
import type { Constituent, ConstituentList, NseIndexId } from "@/lib/apis/niftyIndices";
import { MAX_PEERS, findSectorPeers, getPeers, type PeerDeps } from "../peers";

/** Peers: same NSE sector, narrowest index first, closest in size, every figure sourced or null. */

const c = (symbol: string, sector: string | null): Constituent => ({ symbol, name: `${symbol} Ltd.`, sector, isin: `INE${symbol}` });
const list = (constituents: Constituent[]): ConstituentList => ({ constituents, fetchedAt: "2026-11-14T00:00:00.000Z", source: "NSE Indices constituent list" });

const NIFTY50 = [c("HDFCBANK", "Financial Services"), c("ICICIBANK", "Financial Services"), c("SBIN", "Financial Services"), c("KOTAKBANK", "Financial Services"), c("RELIANCE", "Oil Gas & Consumable Fuels"), c("ONGC", "Oil Gas & Consumable Fuels"), c("TCS", "Information Technology")];
const NIFTY100 = [...NIFTY50, c("IOC", "Oil Gas & Consumable Fuels"), c("BPCL", "Oil Gas & Consumable Fuels"), c("GAIL", "Oil Gas & Consumable Fuels"), c("LTIM", "Information Technology")];
const NIFTY500 = [...NIFTY100, c("SMALLCO", "Textiles"), c("NOSECTOR", null)];
const lists: Partial<Record<NseIndexId, Constituent[]>> = { nifty50: NIFTY50, nifty100: NIFTY100, nifty200: NIFTY100, nifty500: NIFTY500 };
const constituents = async (id: NseIndexId) => (lists[id] ? list(lists[id]!) : null);

// price, previous close, shares, trailing EPS, last-year revenue and net income.
const FIGURES: Record<string, [number, number, number, number | null, number | null, number | null]> = {
  HDFCBANK: [800, 790, 15e9, 40, 4e12, 7e11],
  ICICIBANK: [1500, 1510, 7e9, 60, 3e12, 5e11],
  SBIN: [1000, 1000, 9e9, 80, 6e12, 6e11],
  KOTAKBANK: [2000, 1990, 2e9, -5, null, null],
};

const deps = (overrides: Partial<PeerDeps> = {}): PeerDeps => ({
  constituents,
  history: async (symbol) => {
    const f = FIGURES[symbol];
    return f ? ({ name: null, previousClose: f[1], candles: [{ t: 1, o: null, h: null, l: null, c: f[0], v: null }] } as never) : null;
  },
  fundamentals: async (symbol) => {
    const f = FIGURES[symbol];
    return f ? { sharesOutstanding: { value: f[2], asOf: "2026-09-30" }, epsTtm: f[3] === null ? null : { value: f[3], asOf: "2026-09-30" }, currency: "INR" } : null;
  },
  statements: async (symbol) => {
    const f = FIGURES[symbol];
    return f && f[4] !== null ? { currency: "INR", quarterly: [], annual: [{ asOf: "2026-03-31", values: { revenue: f[4], netIncome: f[5] } }] } : null;
  },
  ...overrides,
});

test("peers come from the narrowest index that has enough of the sector", async () => {
  // Three other financials in the NIFTY 50: no need to look wider.
  const bank = await findSectorPeers("HDFCBANK", constituents);
  assert.deepEqual([bank?.universe, bank?.peers.map((p) => p.symbol)], ["nifty50", ["ICICIBANK", "SBIN", "KOTAKBANK"]]);
  // One other oil company in the NIFTY 50, so the NIFTY 100's four are used.
  const oil = await findSectorPeers("RELIANCE", constituents);
  assert.deepEqual([oil?.universe, oil?.peers.map((p) => p.symbol)], ["nifty100", ["ONGC", "IOC", "BPCL", "GAIL"]]);
  // Too few everywhere: the widest index that has any.
  const it = await findSectorPeers("TCS", constituents);
  assert.deepEqual([it?.universe, it?.peers.map((p) => p.symbol)], ["nifty500", ["LTIM"]]);
  // Alone in its sector, unclassified, or not in the NIFTY 500 (a US stock): no peers, not a guess.
  for (const none of ["SMALLCO", "NOSECTOR", "AAPL"]) assert.equal(await findSectorPeers(none, constituents), null);
  // A list that can't be loaded is skipped, not fatal.
  const flaky = async (id: NseIndexId) => (id === "nifty50" ? Promise.reject(new Error("nse down")) : constituents(id));
  assert.equal((await findSectorPeers("HDFCBANK", flaky))?.universe, "nifty100");
});

test("the table carries each company's sourced figures, the stock marked, largest first", async () => {
  const peers = await getPeers("hdfcbank.ns", deps());
  assert.ok(peers);
  assert.deepEqual([peers.symbol, peers.sector, peers.universe, peers.currency], ["HDFCBANK", "Financial Services", "NIFTY 50", "INR"]);
  assert.match(peers.sectorSource, /NSE sector classification/);
  // Market caps: HDFCBANK 12e12, ICICIBANK 10.5e12, SBIN 9e12, KOTAKBANK 4e12.
  assert.deepEqual(peers.rows.map((r) => r.symbol), ["HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK"]);
  const [self, icici, , kotak] = peers.rows;
  assert.deepEqual([self.isSelf, self.price, self.marketCap, self.pe, self.revenue, self.fiscalYearEnd], [true, 800, 12e12, 12e12 / 7e11, 4e12, "2026-03-31"]);
  assert.equal(self.changePercent?.toFixed(2), "1.27");
  assert.equal(self.netMarginPct?.toFixed(1), "17.5");
  assert.equal(icici.isSelf, false);
  assert.equal(icici.changePercent?.toFixed(2), "-0.66");
  // P/E is market cap ÷ reported net income, whatever the trailing EPS says (HDFCBANK's is 40, which would give 20).
  assert.equal(self.pe?.toFixed(2), "17.14");
  assert.equal(icici.pe?.toFixed(2), "21.00");
  // Without reported statements there's no P/E, and nothing else is filled in.
  assert.deepEqual([kotak.pe, kotak.revenue, kotak.netMarginPct, kotak.fiscalYearEnd], [null, null, null, null]);
});

test("the closest in size are kept, and a provider failure leaves gaps, not wrong numbers", async () => {
  // Nine financials: only the five nearest in market value to the stock are shown.
  const many = Array.from({ length: 9 }, (_, i) => c(`BANK${i}`, "Financial Services"));
  const wide = deps({
    constituents: async () => list([c("HDFCBANK", "Financial Services"), ...many]),
    history: async (symbol) => {
      // BANK0..8 are worth 1e12..9e12; HDFCBANK 12e12.
      const price = symbol === "HDFCBANK" ? 800 : (Number(symbol.replace("BANK", "")) + 1) * 100;
      return { name: null, previousClose: price, candles: [{ t: 1, o: null, h: null, l: null, c: price, v: null }] } as never;
    },
    fundamentals: async (symbol) => ({ sharesOutstanding: { value: symbol === "HDFCBANK" ? 15e9 : 1e10, asOf: "2026-09-30" }, epsTtm: null, currency: "INR" }),
    statements: async () => null,
  });
  const peers = await getPeers("HDFCBANK", wide);
  assert.equal(peers?.rows.length, MAX_PEERS + 1);
  assert.deepEqual(peers?.rows.map((r) => r.symbol), ["HDFCBANK", "BANK8", "BANK7", "BANK6", "BANK5", "BANK4"]);

  // Everything down: the companies are still listed, with every figure empty.
  const down = deps({ history: async () => Promise.reject(new Error("x")), fundamentals: async () => null, statements: async () => Promise.reject(new Error("x")) });
  const bare = await getPeers("HDFCBANK", down);
  assert.equal(bare?.rows.length, 4);
  for (const row of bare!.rows) assert.deepEqual([row.price, row.changePercent, row.marketCap, row.pe, row.revenue], [null, null, null, null, null]);

  // Statements reported in another currency aren't mixed into a rupee table.
  const usd = deps({ statements: async () => ({ currency: "USD", quarterly: [], annual: [{ asOf: "2026-03-31", values: { revenue: 5, netIncome: 1 } }] }) });
  assert.equal((await getPeers("HDFCBANK", usd))?.rows[0].revenue, null);
});

test("the route: peers for a covered stock, 404 with a reason otherwise, 400 for nonsense", async () => {
  const load = async (symbol: string) => getPeers(symbol, deps());
  const ok = await GET(new Request("http://x/api/peers?symbol=hdfcbank"), undefined, load);
  assert.deepEqual([ok.status, (await ok.json()).rows.length], [200, 4]);
  const us = await GET(new Request("http://x/api/peers?symbol=AAPL"), undefined, load);
  assert.deepEqual([us.status, (await us.json()).code], [404, "NOT_COVERED"]);
  assert.equal((await GET(new Request("http://x/api/peers"), undefined, load)).status, 400);
  assert.equal((await GET(new Request("http://x/api/peers?symbol=a%20b%3B"), undefined, load)).status, 400);
  assert.equal((await GET(new Request("http://x/api/peers?symbol=TCS"), undefined, async () => Promise.reject(new Error("down")))).status, 404);
});
