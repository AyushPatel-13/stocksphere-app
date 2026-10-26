import { test } from "node:test";
import assert from "node:assert/strict";

import type { InstrumentRow, InstrumentSearch } from "../../apis/upstoxInstruments";
import { bondFacts, bondMatches, categoryOf, couponOf, maturityOf, parseBondQuery, toBonds } from "../../bonds/bonds";
import { getBond, searchBonds, type BondDeps } from "../../bonds/catalog";
import type { SearchResponse, SearchResult } from "../../search/types";
import { bondResolver } from "../bondCommunity";
import type { Community } from "../communities";
import { attachContext, mentionResolver, searchEntities, type ContextDeps, type EntityDeps } from "../entities";
import { communityResolver } from "../ipoCommunity";
import { insertMention, livePicks, mentionTextFor, removePick, toMentionInputs, type MentionPick } from "../mentionInput";
import { mentionPath, parseMentionInputs, readMentions, type BondMention, type MentionResolver } from "../mentions";
import { assetFilter, createPost, editPost, scopeFilter, type CommunityStore, type EditablePost, type ListQuery, type NewPostRow, type PostEdit } from "../service";
import type { PostView } from "../types";
import { GET as postsRoute } from "@/app/api/community/posts/route";
import { NOW, lookupFrom, memoryDirectory, upstoxDetailBody } from "./fakes";

const POST_ID = "44444444-4444-4444-8444-444444444444";
const IPO = "tonbo-imaging-india-ipo";

/* ------------------------------------------------ exchange rows, as Upstox returns them */

function row(tradingSymbol: string, segment: "NSE_EQ" | "BSE_EQ", isin: string, instrumentType: string, name: string, shortName: string | null = null): InstrumentRow {
  return { tradingSymbol, segment, isin, instrumentKey: `${segment}|${isin}`, instrumentType, name, shortName };
}

const GOI_2033_NSE = row("718GS2033", "NSE_EQ", "IN0020230085", "GS", "GOI LOAN  7.18% 2033");
const GOI_2033_BSE = row("718GS2033", "BSE_EQ", "IN0020230085", "G", "718GS2033");
const GOI_2037 = row("718GS2037", "NSE_EQ", "IN0020230077", "GS", "GOI LOAN  7.18% 2037");
const GOI_2034 = row("71GS2034", "NSE_EQ", "IN0020240019", "GS", "GOI LOAN  7.1% 2034");
const SDL_RJ = row("675RJ30A", "NSE_EQ", "IN2920250270", "SG", "SDL RJ 6.75% 2030");
const TBILL = row("364D080727", "NSE_EQ", "IN002026Z144", "TB", "GOI TBILL 364D-08/07/27");
const SGB = row("SGBSEP31II", "NSE_EQ", "IN0020230093", "GB", "2.50%GOLDBONDS2031SR-II");
const REC_EQ = row("RECLTD", "NSE_EQ", "INE020B01018", "EQ", "REC LIMITED", "REC");
const REC_BOND = row("745RECL35", "NSE_EQ", "INE020B08FG9", "N0", "REC 7.45% 2035 SR 236A");
const REC_TAXFREE = row("871REC28", "NSE_EQ", "INE020B07HS2", "N9", "BOND 8.71% TAX FREE S2B", "REC");
const REC_TWO_RATES = row("812REC27", "NSE_EQ", "INE020B07GH7", "NI", "8.12/8.32% TAX FREE NCD", "REC");
const SBI_EQ = row("SBIN", "NSE_EQ", "INE062A01020", "EQ", "STATE BANK OF INDIA", "SBI");
const SBI_BSE_BOND = row("723SBI39", "BSE_EQ", "INE062A08470", "F", "SBI-7.23%-19-11-39-PVT");

/** Answers like Upstox: whatever rows a query maps to; records the queries. */
function fakeBondDeps(answers: Record<string, InstrumentRow[] | "down">, calls: string[] = []): BondDeps {
  return {
    async search(query) {
      calls.push(query);
      const answer = answers[query.toUpperCase()];
      if (answer === "down") return { ok: false, code: "provider" } satisfies InstrumentSearch;
      return { ok: true, rows: answer ?? [] };
    },
  };
}

const ANSWERS: Record<string, InstrumentRow[] | "down"> = {
  "GOI 2034": [GOI_2034, REC_EQ],
  "GOI 7.18": [GOI_2037, GOI_2033_NSE, GOI_2033_BSE],
  IN0020230085: [GOI_2033_NSE, GOI_2033_BSE],
  INE020B08FG9: [REC_BOND],
  INE020B01: [REC_EQ],
  INE062A01020: [SBI_EQ],
  REC: [REC_EQ, REC_TAXFREE],
  INE020B07: [REC_TAXFREE, REC_TWO_RATES],
  INE020B08: [REC_BOND],
  SBI: [SBI_EQ],
};

/* ------------------------------------------------ 1. records: only what the exchange states */

test("rows are bonds only when the exchange type and the ISIN agree; equities never are", () => {
  assert.equal(categoryOf(GOI_2033_NSE), "government");
  assert.equal(categoryOf(GOI_2033_BSE), "government");
  assert.equal(categoryOf(SDL_RJ), "state");
  assert.equal(categoryOf(TBILL), "tbill");
  assert.equal(categoryOf(SGB), "sgb");
  assert.equal(categoryOf(REC_BOND), "corporate");
  assert.equal(categoryOf(SBI_BSE_BOND), "corporate");
  assert.equal(categoryOf(REC_EQ), null, "the issuer's stock is not a bond");
  assert.equal(categoryOf(row("RECLTD", "NSE_EQ", "INE020B01018", "N0", "REC LIMITED")), null, "a debt series on an equity ISIN is refused");
  assert.equal(categoryOf(row("718GS2033", "NSE_EQ", "INE020B08FG9", "GS", "x")), null, "a G-Sec type on a company ISIN is refused");
});

test("coupon and maturity are read only where the description states them unambiguously", () => {
  assert.equal(couponOf("GOI LOAN 7.18% 2033", "government"), 7.18);
  assert.equal(couponOf("2.50%GOLDBONDS2031SR-II", "sgb"), 2.5);
  assert.equal(couponOf("8.12/8.32% TAX FREE NCD", "corporate"), null, "two rates: neither is shown");
  assert.equal(couponOf("GOI TBILL 364D-08/07/27", "tbill"), null, "a T-bill has no coupon");
  assert.equal(couponOf("BOND 8.71% TAX FREE S2B", "corporate"), 8.71);

  assert.equal(maturityOf("GOI LOAN  7.18% 2033", "government"), "2033");
  assert.equal(maturityOf("GOI TBILL 364D-08/07/27", "tbill"), "2027-07-08");
  assert.equal(maturityOf("2.50%GOLDBONDS2031SR-II", "sgb"), "2031");
  assert.equal(maturityOf("REC 7.45% 2035 SR 236A", "corporate"), "2035");
  assert.equal(maturityOf("SBI-7.23%-19-11-39-PVT", "corporate"), "2039-11-19");
  assert.equal(maturityOf("NHAI-6.94%-27-11-2037-PVT", "corporate"), "2037-11-27");
  assert.equal(maturityOf("BOND 8.71% TAX FREE S2B", "corporate"), null);
  assert.equal(maturityOf("SBI-8.10%-PERPETUAL-PVT", "corporate"), null);
});

test("one bond per ISIN, NSE's description first, both listings kept; issuer from the ISIN", () => {
  const [bond] = toBonds([GOI_2033_BSE, GOI_2033_NSE]);
  assert.deepEqual(bond, {
    isin: "IN0020230085",
    name: "GOI LOAN 7.18% 2033",
    issuer: "Government of India",
    category: "government",
    coupon: 7.18,
    maturity: "2033",
    currency: "INR",
    listings: [{ exchange: "NSE", symbol: "718GS2033" }, { exchange: "BSE", symbol: "718GS2033" }],
  });
  assert.equal(toBonds([SDL_RJ])[0].issuer, "State government");
  assert.equal(toBonds([REC_BOND])[0].issuer, null, "a company's name is never guessed");
  assert.equal(toBonds([REC_BOND], new Map([["INE020B", "REC LIMITED"]]))[0].issuer, "REC LIMITED");
  assert.equal(bondFacts(bond), "Government of India · 7.18% · matures 2033 · IN0020230085");
  assert.equal(bondFacts({ issuer: null, coupon: null, maturity: null, isin: "INE020B07HS2" }), "INE020B07HS2", "missing fields are left out, not filled");
});

/* ------------------------------------------------ 2. search: name, issuer, ISIN, aliases */

test("search by name and alias: 'Government of India 2034 bond' finds GOI 2034 bonds only", async () => {
  const calls: string[] = [];
  const found = await searchBonds("Government of India 2034 bond", fakeBondDeps(ANSWERS, calls));
  assert.deepEqual(calls, ["GOI 2034"]);
  assert.deepEqual(found.bonds.map((b) => b.isin), ["IN0020240019"]);

  const coupon = await searchBonds("GOI 7.18 2033", fakeBondDeps({ "GOI 7.18 2033": [GOI_2037, GOI_2033_NSE] }));
  assert.deepEqual(coupon.bonds.map((b) => b.isin), ["IN0020230085"], "year and coupon both filter");

  assert.deepEqual(parseBondQuery("sgb 2031")?.upstream, "GOLDBONDS2031");
  assert.deepEqual(parseBondQuery("t-bill")?.categories, ["tbill"]);
  assert.equal(parseBondQuery("bond"), null, "a bare 'bond' names nothing");
});

test("search by ISIN returns exactly that bond", async () => {
  const found = await searchBonds("in0020230085", fakeBondDeps(ANSWERS));
  assert.deepEqual(found.bonds.map((b) => [b.isin, b.listings.length]), [["IN0020230085", 2]]);
});

test("search by issuer: 'REC bond' finds REC's bonds through its ISIN issuer code, not its ticker", async () => {
  const calls: string[] = [];
  const found = await searchBonds("REC bond", fakeBondDeps(ANSWERS, calls));
  assert.deepEqual(calls.slice(0, 3), ["rec", "INE020B07", "INE020B08"]);
  assert.deepEqual(found.bonds.map((b) => b.isin).sort(), ["INE020B07GH7", "INE020B07HS2", "INE020B08FG9"]);
  for (const bond of found.bonds) {
    assert.equal(bond.issuer, "REC LIMITED");
    assert.notEqual(bond.isin, REC_EQ.isin, "the equity is never a result");
    assert.ok(!bond.listings.some((l) => l.symbol === "RECLTD"), "the stock ticker is never a bond's id");
  }
  assert.equal(found.bonds.find((b) => b.isin === "INE020B07GH7")!.coupon, null);
});

test("a plain stock query doesn't fan out into an issuer's bonds; failures are partial, not errors", async () => {
  const calls: string[] = [];
  await searchBonds("sbi", fakeBondDeps(ANSWERS, calls));
  assert.deepEqual(calls, ["sbi"]);
  const down = await searchBonds("GOI 2034", fakeBondDeps({ "GOI 2034": "down" }));
  assert.deepEqual(down, { bonds: [], partial: true });
  // "RBI Floating Rate Savings Bond" isn't exchange-listed: nothing is invented for it.
  assert.deepEqual((await searchBonds("RBI Floating Rate Savings Bond", fakeBondDeps({}))).bonds, []);
});

test("getBond: a listed bond with its issuer; a stock's ISIN is not a bond", async () => {
  const deps = fakeBondDeps({ ...ANSWERS, INE062A08470: [SBI_BSE_BOND], INE062A01: [SBI_EQ] });
  const sbi = await getBond("INE062A08470", deps);
  assert.ok(sbi.ok);
  assert.equal(sbi.bond.issuer, "STATE BANK OF INDIA");
  assert.equal(sbi.bond.maturity, "2039-11-19");
  assert.deepEqual(await getBond("INE062A01020", deps), { ok: false, code: "not_found" });
});

/* ------------------------------------------------ 3. the @ list */

function fakeSearch(universe: SearchResult[] = []): EntityDeps["search"] {
  return async (query, limit, filters) => ({ query, results: universe.filter((r) => filters.types.includes(r.type) && r.symbol.toLowerCase().startsWith(query.toLowerCase())).slice(0, limit), partial: false }) satisfies SearchResponse;
}
const SBIN: SearchResult = { id: "India:SBIN", symbol: "SBIN", name: "State Bank of India", type: "stock", exchange: "NSE", market: "India", currency: "INR", href: "/stock/SBIN" };
const EMPTY_BOARD = async () => ({ ok: false as const, code: "not_configured" as const, message: "" });

test("the @ list adds bonds with verified fields; a bond query lists bonds first", async () => {
  const deps: EntityDeps = { search: fakeSearch([SBIN]), ipoBoard: EMPTY_BOARD, bonds: (q) => searchBonds(q, fakeBondDeps({ ...ANSWERS, SBI: [SBI_EQ, row("723SBI39", "NSE_EQ", "INE062A08470", "N0", "SBI 7.23% 2039 SR 3")] })) };
  const goi = await searchEntities("GOI 7.18", deps);
  assert.equal(goi.results[0].kind, "bond");
  const first = goi.results[0];
  assert.ok(first.kind === "bond");
  assert.deepEqual(
    { isin: first.isin, symbol: first.symbol, issuer: first.issuer, coupon: first.coupon, maturity: first.maturity, exchange: first.exchange, href: first.href },
    { isin: "IN0020230077", symbol: "718GS2037", issuer: "Government of India", coupon: 7.18, maturity: "2037", exchange: "NSE", href: "/bonds/IN0020230077" }
  );

  const sbi = await searchEntities("sbi", deps);
  assert.deepEqual(sbi.results.map((r) => r.kind), ["instrument", "bond"], "stocks first for a stock query");

  const failing = await searchEntities("GOI 7.18", { ...deps, bonds: async () => ({ bonds: [], partial: true }) });
  assert.equal(failing.partial, true);
});

test("picking a bond inserts its exchange symbol, removing it removes only that mention", () => {
  const text = mentionTextFor({ kind: "bond", symbol: "718GS2033" });
  assert.equal(text, "@718GS2033");
  const typed = insertMention("Thoughts on @goi 7.18 vs @SBIN?", 12, 21, text);
  assert.equal(typed.text, "Thoughts on @718GS2033 vs @SBIN?");

  const picks: MentionPick[] = [
    { kind: "bond", isin: "IN0020230085", text, name: "GOI LOAN 7.18% 2033", detail: "" },
    { kind: "instrument", id: "India:SBIN", type: "stock", text: "@SBIN", name: "State Bank of India", detail: "" },
  ];
  assert.deepEqual(toMentionInputs(livePicks(typed.text, picks)), [
    { kind: "bond", isin: "IN0020230085", text: "@718GS2033" },
    { kind: "instrument", id: "India:SBIN", type: "stock", text: "@SBIN" },
  ]);
  const removed = removePick(typed.text, picks, 0);
  assert.equal(removed.text, "Thoughts on vs @SBIN?");
  assert.deepEqual(removed.picks.map((p) => p.kind), ["instrument"]);
});

/* ------------------------------------------------ 4. creating, editing, verifying */

function postStore(existing?: EditablePost) {
  const inserted: NewPostRow[] = [];
  const edits: PostEdit[] = [];
  const asView = (r: { body: string; symbols: string[]; mentions?: PostView["mentions"] }): PostView => ({
    id: POST_ID, body: r.body, sentiment: null, symbols: r.symbols, parentId: null, likeCount: 2, replyCount: 0,
    createdAt: new Date(NOW).toISOString(), mentions: r.mentions ?? [],
    author: { username: "ayush", displayName: "Ayush", avatarUrl: null, role: "user", stats: { resolved: 0, wins: 0, points: 0 } },
  });
  const store: CommunityStore = {
    verifyToken: async (token) => (token === "good" ? "user-1" : token === "other" ? "user-2" : null),
    getAuthor: async (id) => ({ id, createdAt: "2026-09-01T00:00:00.000Z" }),
    countPostsSince: async () => 0,
    recentBodies: async () => [],
    getParent: async () => null,
    insertPost: async (r) => {
      inserted.push(r);
      return asView(r);
    },
    listPosts: async () => [],
    sentiment: async () => ({ bullish: 0, bearish: 0, total: 0 }),
    recentSymbols: async () => [],
    getPostForEdit: async (id) => (id === POST_ID ? (existing ?? null) : null),
    updatePost: async (_id, _author, edit) => {
      edits.push(edit);
      return asView(edit);
    },
  };
  return { store, inserted, edits };
}

function resolverWith(directory = memoryDirectory(), bondAnswers = ANSWERS): MentionResolver {
  return mentionResolver(
    communityResolver(directory, lookupFrom({ [IPO]: upstoxDetailBody() })),
    { search: fakeSearch([SBIN]) },
    bondResolver(directory, (isin) => getBond(isin, fakeBondDeps(bondAnswers)))
  );
}

test("a post linked to a bond stores the server's record, not the client's, and a community by ISIN", async () => {
  const directory = memoryDirectory();
  const { store, inserted } = postStore();
  const body = "@718GS2033 or @Tonbo Imaging India IPO or @SBIN?";
  const mentions = [
    // Extra fields a client might send are ignored: only kind, isin and text are read.
    { kind: "bond", isin: "IN0020230085", text: "@718GS2033", issuer: "Fake Issuer", coupon: 99, maturity: "2099" },
    { kind: "ipo", ipoId: IPO, text: "@Tonbo Imaging India IPO" },
    { kind: "instrument", id: "India:SBIN", type: "stock", text: "@SBIN" },
  ];
  const out = await createPost({ token: "good", body, mentions }, store, NOW, null, resolverWith(directory));
  assert.equal(out.ok, true);

  const saved = inserted[0];
  const bondMention = saved.mentions![0] as BondMention;
  const bondCommunity = [...directory.rows.values()].find((c) => c.type === "bond")!;
  assert.deepEqual(bondMention, {
    kind: "bond", communityId: bondCommunity.id, isin: "IN0020230085", symbol: "718GS2033", name: "GOI LOAN 7.18% 2033",
    issuer: "Government of India", category: "government", coupon: 7.18, maturity: "2033", start: 0, end: 10,
  });
  assert.equal(bondCommunity.isin, "IN0020230085");
  assert.equal(bondCommunity.symbol, null, "a bond community never gets a ticker");
  assert.equal(saved.mention_community_ids!.length, 2, "IPO and bond communities, for the indexed filters");
  assert.ok(saved.mention_community_ids!.includes(bondCommunity.id));
  assert.deepEqual(saved.symbols, ["SBIN"], "bonds stay out of posts.symbols (stock boards, Trending)");
  assert.deepEqual(saved.mentions!.map((m) => m.kind), ["bond", "ipo", "instrument"], "stocks and IPOs still work alongside");

  // The same bond mentioned again reuses its community.
  await createPost({ token: "good", body: "again @718GS2033", mentions: [{ kind: "bond", isin: "IN0020230085", text: "@718GS2033" }] }, store, NOW, null, resolverWith(directory));
  assert.equal([...directory.rows.values()].filter((c) => c.type === "bond").length, 1);
});

test("a bond is never guessed: bad ISINs, tickers, unknown bonds and stock ISINs are refused", async () => {
  assert.equal(parseMentionInputs([{ kind: "bond", isin: "REC", text: "@REC" }]).ok, false, "a ticker is not a bond id");
  assert.equal(parseMentionInputs([{ kind: "bond", isin: "in0020230085", text: "@x" }]).ok, false);
  assert.equal(parseMentionInputs([{ kind: "bond", text: "@x" }]).ok, false);

  const { store, inserted } = postStore();
  const unknown = await createPost({ token: "good", body: "@ghost", mentions: [{ kind: "bond", isin: "IN0099999999", text: "@ghost" }] }, store, NOW, null, resolverWith());
  assert.deepEqual(unknown.ok ? null : [unknown.status, unknown.code], [422, "MENTION_UNKNOWN"]);
  const stockIsin = await createPost({ token: "good", body: "@SBIN", mentions: [{ kind: "bond", isin: "INE062A01020", text: "@SBIN" }] }, store, NOW, null, resolverWith());
  assert.equal(stockIsin.ok, false);
  const down = await createPost({ token: "good", body: "@718GS2033", mentions: [{ kind: "bond", isin: "IN0020230085", text: "@718GS2033" }] }, store, NOW, null, resolverWith(memoryDirectory(), { IN0020230085: "down" }));
  assert.deepEqual(down.ok ? null : [down.status, down.code], [503, "MENTION_UNAVAILABLE"]);
  assert.equal(inserted.length, 0);
});

test("before the bond migration is applied, a bond mention says so and nothing is saved", async () => {
  const directory = memoryDirectory();
  directory.ensureBond = async () => {
    throw Object.assign(new Error("violates check constraint communities_type_values"), { code: "23514" });
  };
  const { store, inserted } = postStore();
  const out = await createPost({ token: "good", body: "@718GS2033", mentions: [{ kind: "bond", isin: "IN0020230085", text: "@718GS2033" }] }, store, NOW, null, resolverWith(directory));
  assert.deepEqual(out.ok ? null : [out.status, out.code], [503, "NOT_CONFIGURED"]);
  assert.equal(inserted.length, 0);
  // Posts without bonds are unaffected.
  assert.equal((await createPost({ token: "good", body: "@SBIN", mentions: [{ kind: "instrument", id: "India:SBIN", type: "stock", text: "@SBIN" }] }, store, NOW, null, resolverWith(directory))).ok, true);
});

const BOND_MENTION: BondMention = {
  kind: "bond", communityId: "00000000-0000-4000-8000-0000000000b1", isin: "IN0020230085", symbol: "718GS2033", name: "GOI LOAN 7.18% 2033",
  issuer: "Government of India", category: "government", coupon: 7.18, maturity: "2033", start: 0, end: 10,
};

test("an author's edit keeps a bond mention, or removes it", async () => {
  const existing: EditablePost = { authorId: "user-1", parentId: null, body: "@718GS2033 looks cheap", symbols: [], mentions: [BOND_MENTION], hidden: false };

  const kept = postStore(existing);
  const keep = await editPost({ token: "good", postId: POST_ID, body: "@718GS2033 looks cheap now", mentions: [{ kind: "bond", isin: "IN0020230085", text: "@718GS2033" }] }, kept.store, NOW, resolverWith());
  assert.equal(keep.ok, true);
  assert.equal(kept.edits[0].mentions[0].kind, "bond");
  assert.equal(kept.edits[0].mention_community_ids.length, 1);

  const removed = postStore(existing);
  const drop = await editPost({ token: "good", postId: POST_ID, body: "looks cheap", mentions: [] }, removed.store, NOW, resolverWith());
  assert.equal(drop.ok, true);
  assert.deepEqual(removed.edits[0].mentions, []);
  assert.deepEqual(removed.edits[0].mention_community_ids, [], "the bond's page stops listing it");

  const other = postStore(existing);
  const denied = await editPost({ token: "other", postId: POST_ID, body: "mine now", mentions: [] }, other.store, NOW, resolverWith());
  assert.deepEqual(denied.ok ? null : denied.status, 404, "only the author can change a post's mentions");
});

/* ------------------------------------------------ 5. showing it */

test("stored bond mentions render as a link to /bonds/<ISIN>; malformed ones are dropped", () => {
  const body = "@718GS2033 looks cheap";
  assert.deepEqual(readMentions([BOND_MENTION], body), [BOND_MENTION]);
  assert.equal(mentionPath(BOND_MENTION, () => "/never"), "/bonds/IN0020230085");
  assert.deepEqual(readMentions([{ ...BOND_MENTION, isin: "SBIN" }], body), []);
  assert.deepEqual(readMentions([{ ...BOND_MENTION, category: "junk" }], body), []);
  assert.deepEqual(readMentions([{ ...BOND_MENTION, communityId: "nope" }], body), []);
  assert.equal((readMentions([{ ...BOND_MENTION, maturity: "<b>soon</b>", coupon: "7%" }], body)[0] as BondMention).maturity, null);
});

test("the 'Discussing bond' context comes from the stored record, with verified fields only", async () => {
  const post: PostView = {
    id: POST_ID, body: "@718GS2033 looks cheap", sentiment: null, symbols: [], parentId: null, likeCount: 0, replyCount: 0, createdAt: new Date(NOW).toISOString(),
    author: { username: "a", displayName: "A", avatarUrl: null, role: "user", stats: { resolved: 0, wins: 0, points: 0 } },
    mentions: [BOND_MENTION, { ...BOND_MENTION, start: 0, end: 10 }],
  };
  let communityQueries = 0;
  const deps: ContextDeps = { communities: async () => (communityQueries++, [] as Community[]), ipoBoard: EMPTY_BOARD };
  const [withContext] = await attachContext([post], deps);
  assert.deepEqual(withContext.context, [
    { kind: "bond", communityId: BOND_MENTION.communityId, isin: "IN0020230085", name: "GOI LOAN 7.18% 2033", issuer: "Government of India", category: "government", coupon: 7.18, maturity: "2033", href: "/bonds/IN0020230085", via: "mention" },
  ]);
  assert.equal(communityQueries, 0, "no lookups for bond context");
  const card = withContext.context![0];
  assert.ok(card.kind === "bond");
  assert.equal(bondFacts(card), "Government of India · 7.18% · matures 2033 · IN0020230085");
});

/* ------------------------------------------------ 6. discovery: the bond's page and the floor filter */

function listingStore() {
  const queries: ListQuery[] = [];
  const { store } = postStore();
  store.listPosts = async (q) => {
    queries.push(q);
    return [];
  };
  return { store, queries };
}

test("GET ?bond=<ISIN> lists the posts that mention that bond (its community), nothing for an unmentioned one", async () => {
  const directory = memoryDirectory();
  const bond = await directory.ensureBond({ isin: "IN0020230085", name: "GOI LOAN 7.18% 2033" });
  const bonds = bondResolver(directory, async () => ({ ok: false, code: "provider" }));
  const { store, queries } = listingStore();

  const ok = await postsRoute(new Request("http://x/api/community/posts?bond=in0020230085"), undefined, store, null, null, bonds);
  assert.equal(ok.status, 200);
  assert.deepEqual(queries[0].community, { communityId: bond.id, anySymbols: [] });
  assert.equal(scopeFilter(queries[0].community!, true), `community_id.eq.${bond.id},mention_community_ids.cs.{${bond.id}}`);

  const none = await postsRoute(new Request("http://x/api/community/posts?bond=IN0020230077"), undefined, store, null, null, bonds);
  assert.deepEqual(await none.json(), { success: true, posts: [], hasMore: false });
  assert.equal(queries.length, 1);

  assert.equal((await postsRoute(new Request("http://x/api/community/posts?bond=RECLTD"), undefined, store, null, null, bonds)).status, 400);
});

test("the floor's Stocks / IPOs / Bonds filter narrows the same posts; All is unchanged", async () => {
  const { store, queries } = listingStore();
  for (const asset of ["all", "stock", "ipo", "bond"]) {
    assert.equal((await postsRoute(new Request(`http://x/api/community/posts?asset=${asset}`), undefined, store, null, null, null)).status, 200);
  }
  assert.deepEqual(queries.map((q) => q.asset), [undefined, "stock", "ipo", "bond"]);
  assert.equal((await postsRoute(new Request("http://x/api/community/posts?asset=crypto"), undefined, store, null, null, null)).status, 400);
  // A board's own feed ignores the floor filter.
  await postsRoute(new Request("http://x/api/community/posts?symbol=TCS&asset=bond"), undefined, store, null, null, null);
  assert.equal(queries.at(-1)!.asset, undefined);

  const full = { mentions: true, community: true };
  assert.deepEqual(assetFilter("bond", full), { column: "mentions", op: "cs", value: '[{"kind":"bond"}]' });
  assert.deepEqual(assetFilter("ipo", full), { or: 'community_id.not.is.null,mentions.cs.[{"kind":"ipo"}]' });
  assert.deepEqual(assetFilter("stock", full), { column: "symbols", op: "not.eq", value: "{}" });
  // Before the mentions columns exist, the Bonds filter has no posts rather than erroring.
  assert.deepEqual(assetFilter("bond", { mentions: false, community: true }), { column: "id", op: "eq", value: "00000000-0000-0000-0000-000000000000" });
});

test("bond matching never crosses categories or years", () => {
  const [goi] = toBonds([GOI_2033_NSE]);
  assert.equal(bondMatches(goi, parseBondQuery("GOI 2033")!), true);
  assert.equal(bondMatches(goi, parseBondQuery("GOI 2034")!), false);
  assert.equal(bondMatches(goi, parseBondQuery("SDL 2033")!), false);
  assert.equal(bondMatches(goi, parseBondQuery("government of india 7.18")!), true);
  assert.equal(bondMatches(goi, parseBondQuery("government of india 7.1")!), false, "coupons match exactly");
});
