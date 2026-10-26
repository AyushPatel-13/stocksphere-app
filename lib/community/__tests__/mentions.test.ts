import { test } from "node:test";
import assert from "node:assert/strict";

import type { SearchResponse, SearchResult } from "../../search/types";
import type { IpoBoardResult, IpoRow } from "../../services/ipo";
import type { Community } from "../communities";
import { attachContext, ipoMatches, mentionResolver, searchEntities, type ContextDeps, type EntityDeps } from "../entities";
import { communityResolver } from "../ipoCommunity";
import { activeMention, insertMention, livePicks, mentionTextFor, removePick, toMentionInputs, type MentionPick } from "../mentionInput";
import { boardSymbolOf, locateMentions, parseMentionInputs, readMentions, resolveMentions, type MentionResolver } from "../mentions";
import { createPost, editPost, scopeFilter, toPostView, type CommunityStore, type EditablePost, type NewPostRow, type PostEdit } from "../service";
import type { PostView } from "../types";
import { GET as entitiesRoute } from "@/app/api/community/entities/route";
import { GET as postsRoute, PATCH as patchRoute, POST as postRoute } from "@/app/api/community/posts/route";
import { LINKED, NOW, lookupFrom, memoryDirectory, upstoxDetailBody } from "./fakes";

const IPO = "tonbo-imaging-india-ipo";
const POST_ID = "33333333-3333-4333-8333-333333333333";

/* ------------------------------------------------ fixtures */

function result(overrides: Partial<SearchResult>): SearchResult {
  return { id: "India:SBIN", symbol: "SBIN", name: "State Bank of India", type: "stock", exchange: "NSE", market: "India", currency: "INR", href: "/stock/SBIN", ...overrides };
}

const SBIN = result({});
const RELIANCE = result({ id: "India:RELIANCE", symbol: "RELIANCE", name: "Reliance Industries", href: "/stock/RELIANCE" });
const NIFTY = result({ id: "index:NIFTY", symbol: "NIFTY", name: "NIFTY 50", type: "index", exchange: "NSE", currency: null, href: "/asset/index/NIFTY" });
const SBI_CARDS = result({ id: "India:SBICARD", symbol: "SBICARD", name: "SBI Cards and Payment Services", href: "/stock/SBICARD.NS" });

/** A fake of the shared search: answers from a fixed universe, honours the type filter. */
function fakeSearch(universe: SearchResult[] = [SBIN, RELIANCE, NIFTY, SBI_CARDS], calls: unknown[] = [], partial = false): EntityDeps["search"] {
  return async (query, limit, filters) => {
    calls.push({ query, limit, filters });
    const q = query.toLowerCase();
    const results = universe
      .filter((r) => filters.types.includes(r.type))
      .filter((r) => r.symbol.toLowerCase().startsWith(q) || r.name.toLowerCase().includes(q))
      .slice(0, limit);
    return { query, results, partial } satisfies SearchResponse;
  };
}

function ipoRow(overrides: Partial<IpoRow>): IpoRow {
  return {
    id: IPO, symbol: null, name: "Tonbo Imaging India IPO", isin: "INE0TON01017", board: "mainboard", industry: null, providerStatus: "open", section: "open",
    listingState: null, openDate: "2026-10-23", closeDate: "2026-10-27", dailyStartTime: null, dailyEndTime: null, priceBand: null, cutOffPrice: null,
    faceValue: null, lotSize: null, minimumQuantity: null, minInvestment: null, issueSizeCr: null, subscription: null,
    demand: { level: "no-data", label: "", basis: "" }, timeline: null, listingExchanges: [], listingPrice: null, listingGainPct: null,
    session: null, rhpUrl: null, drhpUrl: null, gmp: null, detailOk: true, ...overrides,
  };
}

function board(rows: IpoRow[]): IpoBoardResult {
  return {
    ok: true,
    data: { ipos: rows, unclassified: [], today: "2026-10-24", generatedAt: new Date(NOW).toISOString(), staleReason: null, gmp: { available: false, providerName: null, providerUrl: null, updatedAt: null, reason: null }, sources: [] },
  };
}

const IPO_BOARD = board([
  ipoRow({}),
  ipoRow({ id: "sbi-general-ipo", name: "SBI General Insurance IPO", section: "upcoming", openDate: "2026-11-02", closeDate: "2026-11-04" }),
  ipoRow({ id: "sbfc-old-ipo", name: "SBI Old Closed IPO", section: "closed", listingState: "listed" }),
]);

function postStore(existing?: EditablePost) {
  const inserted: NewPostRow[] = [];
  const edits: { id: string; authorId: string; edit: PostEdit }[] = [];
  const asView = (row: { body: string; symbols: string[]; mentions?: PostView["mentions"] }): PostView => ({
    id: POST_ID, body: row.body, sentiment: null, symbols: row.symbols, parentId: null, likeCount: 3, replyCount: 1,
    createdAt: new Date(NOW).toISOString(), mentions: row.mentions ?? [],
    author: { username: "ayush", displayName: "Ayush", avatarUrl: null, role: "user", stats: { resolved: 0, wins: 0, points: 0 } },
  });
  const store: CommunityStore = {
    verifyToken: async (token) => (token === "good" ? "user-1" : token === "other" ? "user-2" : null),
    getAuthor: async (id) => ({ id, createdAt: "2026-09-01T00:00:00.000Z" }),
    countPostsSince: async () => 0,
    recentBodies: async () => [],
    getParent: async (id) => (id === POST_ID ? { symbols: ["TCS"] } : null),
    insertPost: async (row) => {
      inserted.push(row);
      return asView(row);
    },
    listPosts: async () => [],
    sentiment: async () => ({ bullish: 0, bearish: 0, total: 0 }),
    recentSymbols: async () => [],
    getPostForEdit: async (id) => (id === POST_ID ? (existing ?? null) : null),
    updatePost: async (id, authorId, edit) => {
      edits.push({ id, authorId, edit });
      return asView(edit);
    },
  };
  return { store, inserted, edits };
}

function resolver(directory = memoryDirectory(), search = fakeSearch()): MentionResolver {
  return mentionResolver(communityResolver(directory, lookupFrom({ [IPO]: upstoxDetailBody() })), { search });
}

/* ------------------------------------------------ 1. @ opens the autocomplete only in a mention */

test("@ opens the autocomplete at the caret, but not inside words, emails or across lines", () => {
  assert.deepEqual(activeMention("@", 1), { start: 0, query: "" });
  assert.deepEqual(activeMention("Look at @sb", 11), { start: 8, query: "sb" });
  assert.deepEqual(activeMention("(@Reliance Ind", 14), { start: 1, query: "Reliance Ind" });
  assert.deepEqual(activeMention("@tcs and more", 4), { start: 0, query: "tcs" }, "the caret decides, not the end of the text");
  assert.equal(activeMention("mail me@sbi.com", 15), null);
  assert.equal(activeMention("word@sbi", 8), null);
  assert.equal(activeMention("@sbi\nnext", 9), null);
  assert.equal(activeMention("@sbi  bank", 10), null);
  assert.equal(activeMention("@ sbi", 5), null);
  assert.equal(activeMention(`@${"a".repeat(41)}`, 42), null);
  assert.equal(activeMention("@a<b", 4), null);
});

/* ------------------------------------------------ 2–3. stock and IPO search */

test("stock search uses the shared instrument search, limited to types that have a discussion", async () => {
  const calls: { filters: { types: string[] } }[] = [];
  const found = await searchEntities("SBI", { search: fakeSearch(undefined, calls as unknown[]), ipoBoard: async () => IPO_BOARD });
  assert.deepEqual(calls[0].filters.types, ["stock", "etf", "index", "crypto"]);
  const stocks = found.results.filter((r) => r.kind === "instrument");
  assert.deepEqual(stocks.map((r) => r.kind === "instrument" && [r.symbol, r.exchange, r.label]), [
    ["SBIN", "NSE", "Indian stock"],
    ["SBICARD", "NSE", "Indian stock"],
  ]);

  const reliance = await searchEntities("Reliance", { search: fakeSearch(), ipoBoard: async () => IPO_BOARD });
  assert.equal(reliance.results[0].kind === "instrument" && reliance.results[0].name, "Reliance Industries");
});

test("IPO search lists open and upcoming issues from the IPO catalogue, never closed ones", async () => {
  const found = await searchEntities("sbi", { search: fakeSearch([]), ipoBoard: async () => IPO_BOARD });
  assert.deepEqual(found.results.map((r) => r.kind === "ipo" && [r.ipoId, r.status, r.href]), [["sbi-general-ipo", "upcoming", "/community/ipo/sbi-general-ipo"]]);
  const tonbo = await searchEntities("tonbo im", { search: fakeSearch([]), ipoBoard: async () => IPO_BOARD });
  assert.equal(tonbo.results[0].kind === "ipo" && tonbo.results[0].status, "open");
  assert.equal(ipoMatches("Tonbo Imaging India IPO", null, "imag ind"), true);
  assert.equal(ipoMatches("Tonbo Imaging India IPO", null, "bo"), false, "word prefixes only");
});

test("a source that fails leaves the other's results and marks them partial", async () => {
  const noIpos = await searchEntities("SBI", { search: fakeSearch(), ipoBoard: async () => ({ ok: false, code: "auth", message: "expired" }) });
  assert.equal(noIpos.partial, true);
  assert.ok(noIpos.results.length > 0);
  const noStocks = await searchEntities("tonbo", { search: async () => { throw new Error("down"); }, ipoBoard: async () => IPO_BOARD });
  assert.equal(noStocks.partial, true);
  assert.equal(noStocks.results.length, 1);
});

test("the entities route validates and limits its query", async () => {
  const deps: EntityDeps = { search: fakeSearch(), ipoBoard: async () => IPO_BOARD };
  assert.equal((await entitiesRoute(new Request("http://x/api/community/entities?q="), undefined, deps)).status, 400);
  assert.equal((await entitiesRoute(new Request(`http://x/api/community/entities?q=${"a".repeat(41)}`), undefined, deps)).status, 400);
  assert.equal((await entitiesRoute(new Request("http://x/api/community/entities?q=%3Cscript%3E"), undefined, deps)).status, 400);
  const ok = await entitiesRoute(new Request("http://x/api/community/entities?q=sbi", { headers: { "x-forwarded-for": "10.0.0.9" } }), undefined, deps);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).results.length, 3);
});

/* ------------------------------------------------ 4–5. picks store real references; several per post */

test("a pick is inserted readably with the caret after it, and stored as a verified reference", async () => {
  const typed = insertMention("Is @sb good?", 3, 6, mentionTextFor({ kind: "instrument", symbol: "SBIN" }));
  assert.deepEqual(typed, { text: "Is @SBIN good?", caret: 9 });
  assert.deepEqual(insertMention("@reli", 0, 5, "@RELIANCE"), { text: "@RELIANCE ", caret: 10 });

  const { store, inserted } = postStore();
  const picks: MentionPick[] = [{ kind: "instrument", id: "India:SBIN", type: "stock", text: "@SBIN", name: "Fake Name From Client", detail: "x" }];
  const out = await createPost({ token: "good", body: typed.text, mentions: toMentionInputs(picks) }, store, NOW, null, resolver());

  assert.equal(out.ok, true);
  assert.deepEqual(inserted[0].mentions, [
    { kind: "instrument", id: "India:SBIN", type: "stock", symbol: "SBIN", exchange: "NSE", name: "State Bank of India", href: "/stock/SBIN", start: 3, end: 8 },
  ]);
  assert.deepEqual(inserted[0].symbols, ["SBIN"], "the stock's board can list it");
  assert.deepEqual(inserted[0].mention_community_ids, []);
});

test("several mentions — stocks and an IPO, even the same one twice — keep their own positions", async () => {
  const directory = memoryDirectory();
  const { store, inserted } = postStore();
  const body = "@Tonbo Imaging India IPO vs @SBIN and @NIFTY, then @SBIN again";
  const mentions = [
    { kind: "ipo", ipoId: IPO, text: "@Tonbo Imaging India IPO" },
    { kind: "instrument", id: "India:SBIN", type: "stock", text: "@SBIN" },
    { kind: "instrument", id: "index:NIFTY", type: "index", text: "@NIFTY" },
    { kind: "instrument", id: "India:SBIN", type: "stock", text: "@SBIN" },
  ];
  const out = await createPost({ token: "good", body, mentions }, store, NOW, null, resolver(directory));
  assert.equal(out.ok, true);
  const row = inserted[0];
  assert.deepEqual(row.mentions!.map((m) => body.slice(m.start, m.end)), ["@Tonbo Imaging India IPO", "@SBIN", "@NIFTY", "@SBIN"]);
  assert.deepEqual(row.mentions!.map((m) => m.start), [0, 28, 38, 51]);
  assert.deepEqual(row.symbols, ["SBIN", "NIFTY"]);
  // The IPO mention created (once) the IPO's community and points at it.
  assert.equal(directory.rows.size, 1);
  assert.deepEqual(row.mention_community_ids, [[...directory.rows.keys()][0]]);
});

test("the composer keeps only picks still in the text, in order, and can remove one cleanly", () => {
  const picks: MentionPick[] = [
    { kind: "instrument", id: "India:SBIN", type: "stock", text: "@SBIN", name: "SBI", detail: "" },
    { kind: "ipo", ipoId: IPO, text: "@Tonbo Imaging India IPO", name: "Tonbo", detail: "" },
  ];
  const text = "@Tonbo Imaging India IPO or @SBIN?";
  assert.deepEqual(livePicks(text, picks).map((p) => p.text), ["@Tonbo Imaging India IPO", "@SBIN"]);
  assert.deepEqual(livePicks("@Tonbo Imag or @SBIN?", picks).map((p) => p.text), ["@SBIN"], "an edited mention is dropped");
  assert.deepEqual(livePicks("x@SBIN", picks), [], "not inside a word");
  assert.deepEqual(removePick(text, livePicks(text, picks), 1), { text: "@Tonbo Imaging India IPO or ?", picks: [livePicks(text, picks)[0]] });
});

/* ------------------------------------------------ 6. IPO context on posts, from relations only */

function contextDeps(communities: Community[], ipoBoard: IpoBoardResult = IPO_BOARD, calls = { communities: 0, board: 0 }): ContextDeps {
  return {
    communities: async (ids) => {
      calls.communities++;
      return communities.filter((c) => ids.includes(c.id));
    },
    ipoBoard: async () => {
      calls.board++;
      return ipoBoard;
    },
  };
}

const TONBO_IPO: Community = { ...LINKED, type: "ipo", exchange: null, symbol: null, listedAt: null };

function view(overrides: Partial<PostView>): PostView {
  return {
    id: POST_ID, body: "should i trust this ipo ?", sentiment: null, symbols: [], parentId: null, likeCount: 0, replyCount: 0,
    createdAt: new Date(NOW).toISOString(), author: { username: "a", displayName: "A", avatarUrl: null, role: "user", stats: { resolved: 0, wins: 0, points: 0 } },
    ...overrides,
  };
}

test("a post written in an IPO's community says so, with the status from Upstox's catalogue", async () => {
  const calls = { communities: 0, board: 0 };
  const [post] = await attachContext([view({ communityId: TONBO_IPO.id })], contextDeps([TONBO_IPO], IPO_BOARD, calls));
  assert.deepEqual(post.context, [
    { kind: "ipo", communityId: TONBO_IPO.id, ipoId: IPO, name: "Tonbo Imaging India IPO", status: "open", href: `/community/ipo/${IPO}`, listed: null, via: "community" },
  ]);
});

test("no IPO is ever inferred from a post's text", async () => {
  const calls = { communities: 0, board: 0 };
  const posts = await attachContext([view({}), view({ body: "Tonbo Imaging India IPO looks good, @tonbo" })], contextDeps([TONBO_IPO], IPO_BOARD, calls));
  assert.deepEqual(posts.map((p) => p.context), [undefined, undefined]);
  assert.deepEqual(calls, { communities: 0, board: 0 }, "nothing is even looked up");
});

test("context for a whole page takes one communities query and one board read (no N+1)", async () => {
  const calls = { communities: 0, board: 0 };
  const posts = Array.from({ length: 20 }, () => view({ communityId: TONBO_IPO.id }));
  await attachContext(posts, contextDeps([TONBO_IPO], IPO_BOARD, calls));
  assert.deepEqual(calls, { communities: 1, board: 1 });

  // Upstox down: the badge stays, without a status.
  const [down] = await attachContext([view({ communityId: TONBO_IPO.id })], contextDeps([TONBO_IPO], { ok: false, code: "auth", message: "x" }));
  assert.equal(down.context?.[0].kind === "ipo" && down.context[0].status, null);
});

test("after listing, the same reference shows the IPO as listed and links its stock", async () => {
  const mention = { kind: "ipo" as const, communityId: LINKED.id, ipoId: IPO, name: "Tonbo Imaging India IPO", start: 0, end: 24 };
  const [post] = await attachContext(
    [view({ body: "@Tonbo Imaging India IPO listed well", mentions: [mention] })],
    contextDeps([LINKED], board([]))
  );
  assert.deepEqual(post.context, [
    { kind: "ipo", communityId: LINKED.id, ipoId: IPO, name: "Tonbo Imaging India IPO", status: "listed", href: `/community/ipo/${IPO}`, listed: { exchange: "NSE", symbol: "TONBO", href: "/stock/TONBO.NS" }, via: "mention" },
  ]);
});

/* ------------------------------------------------ 7. mention destinations */

test("mentions link to the existing routes, and stored rows are re-checked before use", () => {
  assert.equal(boardSymbolOf("/stock/SBIN"), "SBIN");
  assert.equal(boardSymbolOf("/stock/SBICARD.NS"), "SBICARD.NS");
  assert.equal(boardSymbolOf("/asset/index/NIFTY"), "NIFTY");
  assert.equal(boardSymbolOf("https://evil.example/stock/SBIN"), null);
  assert.equal(boardSymbolOf("/asset/bond/IN10Y"), null, "bond pages have no discussion");

  const body = "@SBIN and @Tonbo Imaging India IPO";
  const stored = [
    { kind: "instrument", id: "India:SBIN", type: "stock", symbol: "SBIN", exchange: "NSE", name: "State Bank of India", href: "/stock/SBIN", start: 0, end: 5 },
    { kind: "ipo", communityId: LINKED.id, ipoId: IPO, name: "Tonbo", start: 10, end: 34 },
    { kind: "instrument", id: "x", type: "stock", symbol: "X", href: "javascript:alert(1)", start: 0, end: 2 },
    { kind: "ipo", communityId: "not-a-uuid", ipoId: IPO, start: 0, end: 5 },
    { kind: "instrument", id: "India:SBIN", symbol: "SBIN", href: "/stock/SBIN", start: 30, end: 99 },
  ];
  const read = readMentions(stored, body);
  assert.deepEqual(read.map((m) => [m.kind, body.slice(m.start, m.end)]), [["instrument", "@SBIN"], ["ipo", "@Tonbo Imaging India IPO"]]);
});

/* ------------------------------------------------ 8. stock and IPO pages list linked posts */

test("an IPO's feed includes posts that mention it; a stock board includes posts that tag it", async () => {
  assert.equal(
    scopeFilter({ communityId: LINKED.id, anySymbols: ["TONBO"] }, true),
    `community_id.eq.${LINKED.id},mention_community_ids.cs.{${LINKED.id}},symbols.ov.{"TONBO"}`
  );
  // Stock mentions add the board symbol, which is what stock boards read (symbols @> {SBIN}).
  const { store, inserted } = postStore();
  await createPost({ token: "good", body: "On the main feed: @SBIN", mentions: [{ kind: "instrument", id: "India:SBIN", type: "stock", text: "@SBIN" }] }, store, NOW, null, resolver());
  assert.ok(inserted[0].symbols.includes("SBIN"));
});

test("posts come back with their context from the posts route", async () => {
  const { store } = postStore();
  store.listPosts = async () => [view({ communityId: TONBO_IPO.id })];
  const response = await postsRoute(new Request("http://x/api/community/posts"), undefined, store, null, contextDeps([TONBO_IPO]));
  const json = await response.json();
  assert.equal(json.posts[0].context[0].name, "Tonbo Imaging India IPO");
});

/* ------------------------------------------------ 9. edits */

const EXISTING: EditablePost = {
  authorId: "user-1",
  parentId: null,
  body: "On TCS's board: @SBIN looks cheap, $INFY too",
  symbols: ["TCS", "SBIN", "INFY"],
  mentions: [{ kind: "instrument", id: "India:SBIN", type: "stock", symbol: "SBIN", exchange: "NSE", name: "State Bank of India", href: "/stock/SBIN", start: 16, end: 21 }],
  hidden: false,
};

test("an edit keeps the board, keeps or replaces mentions, and drops symbols that only the old text added", async () => {
  const { store, edits } = postStore(EXISTING);
  const kept = await editPost({ token: "good", postId: POST_ID, body: "Still: @SBIN looks cheap", mentions: [{ kind: "instrument", id: "India:SBIN", type: "stock", text: "@SBIN" }] }, store, NOW, resolver());
  assert.equal(kept.ok, true);
  assert.deepEqual(edits[0].edit.symbols, ["TCS", "SBIN"]);
  assert.equal(edits[0].edit.mentions[0].start, 7);
  assert.equal(edits[0].edit.edited_at, new Date(NOW).toISOString());

  await editPost({ token: "good", postId: POST_ID, body: "Switched to @RELIANCE", mentions: [{ kind: "instrument", id: "India:RELIANCE", type: "stock", text: "@RELIANCE" }] }, store, NOW, resolver());
  assert.deepEqual(edits[1].edit.symbols, ["TCS", "RELIANCE"]);

  await editPost({ token: "good", postId: POST_ID, body: "No tags any more" }, store, NOW, resolver());
  assert.deepEqual([edits[2].edit.symbols, edits[2].edit.mentions], [["TCS"], []]);
});

test("only the author can edit, and never a hidden post", async () => {
  const { store, edits } = postStore(EXISTING);
  const other = await editPost({ token: "other", postId: POST_ID, body: "mine now" }, store, NOW, resolver());
  assert.deepEqual(other.ok ? null : other.status, 404);
  const signedOut = await editPost({ token: null, postId: POST_ID, body: "x" }, store, NOW, resolver());
  assert.deepEqual(signedOut.ok ? null : signedOut.status, 401);
  const hidden = await editPost({ token: "good", postId: POST_ID, body: "x" }, postStore({ ...EXISTING, hidden: true }).store, NOW, resolver());
  assert.deepEqual(hidden.ok ? null : hidden.status, 404);
  const spam = await editPost({ token: "good", postId: POST_ID, body: "join my telegram channel for sure-shot tips" }, store, NOW, resolver());
  assert.deepEqual(spam.ok ? null : spam.status, 422);
  assert.equal(edits.length, 0);

  const route = await patchRoute(new Request("http://x/api/community/posts", { method: "PATCH", body: JSON.stringify({ id: POST_ID, body: "x" }) }), undefined, store, resolver(), null);
  assert.equal(route.status, 401);
});

/* ------------------------------------------------ 10. old posts still render */

test("an old post (no mention columns, no community) reads exactly as before", () => {
  const old = toPostView({
    id: POST_ID, body: "@ayush thinks $TCS is fine", sentiment: "bullish", symbols: ["TCS"], parent_id: null, like_count: 2, reply_count: 0,
    created_at: new Date(NOW).toISOString(), author: { username: "a", display_name: "A", avatar_url: null, role: "user" },
  });
  assert.deepEqual([old.mentions, old.communityId, old.editedAt, old.context], [[], null, null, undefined]);
});

/* ------------------------------------------------ 11. invalid ids and unauthorised requests */

test("malformed, unknown or tampered mentions are refused", async () => {
  const bad = [
    [{ kind: "user", id: "x", text: "@x" }],
    [{ kind: "instrument", id: "India:SBIN", type: "bond", text: "@SBIN" }],
    [{ kind: "instrument", id: "../../etc", type: "stock", text: "@SBIN" }],
    [{ kind: "instrument", id: "India:SBIN", type: "stock", text: "SBIN" }],
    [{ kind: "ipo", ipoId: "../x", text: "@x" }],
    "not-a-list",
    Array.from({ length: 6 }, () => ({ kind: "instrument", id: "India:SBIN", type: "stock", text: "@SBIN" })),
  ];
  for (const mentions of bad) assert.equal(parseMentionInputs(mentions).ok, false, JSON.stringify(mentions).slice(0, 60));

  const { store, inserted } = postStore();
  const unknown = await createPost({ token: "good", body: "@ZZZZ", mentions: [{ kind: "instrument", id: "India:ZZZZ", type: "stock", text: "@ZZZZ" }] }, store, NOW, null, resolver());
  assert.deepEqual(unknown.ok ? null : [unknown.status, unknown.code], [422, "MENTION_UNKNOWN"]);
  // An id the search knows, but under another type, is not that instrument.
  const wrongType = await createPost({ token: "good", body: "@SBIN", mentions: [{ kind: "instrument", id: "India:SBIN", type: "etf", text: "@SBIN" }] }, store, NOW, null, resolver());
  assert.equal(wrongType.ok, false);
  const unknownIpo = await createPost({ token: "good", body: "@Ghost IPO", mentions: [{ kind: "ipo", ipoId: "ghost-ipo", text: "@Ghost IPO" }] }, store, NOW, null, resolver());
  assert.deepEqual(unknownIpo.ok ? null : unknownIpo.status, 404);
  const missingText = await createPost({ token: "good", body: "no mention here", mentions: [{ kind: "instrument", id: "India:SBIN", type: "stock", text: "@SBIN" }] }, store, NOW, null, resolver());
  assert.deepEqual(missingText.ok ? null : missingText.code, "MENTION_TEXT");
  const searchDown = await createPost({ token: "good", body: "@ZZZZ", mentions: [{ kind: "instrument", id: "India:ZZZZ", type: "stock", text: "@ZZZZ" }] }, store, NOW, null, resolver(undefined, fakeSearch([], [], true)));
  assert.deepEqual(searchDown.ok ? null : searchDown.status, 503);
  const signedOut = await createPost({ token: null, body: "@SBIN", mentions: [{ kind: "instrument", id: "India:SBIN", type: "stock", text: "@SBIN" }] }, store, NOW, null, resolver());
  assert.deepEqual(signedOut.ok ? null : signedOut.status, 401);
  assert.equal(inserted.length, 0);

  const route = await postRoute(
    new Request("http://x/api/community/posts", { method: "POST", headers: { Authorization: "Bearer good" }, body: JSON.stringify({ body: "@SBIN", mentions: [{ kind: "nope" }] }) }),
    undefined, store, null, resolver(), null
  );
  assert.equal(route.status, 400);
});

test("mentions are located after the body is normalised, at word boundaries", () => {
  assert.deepEqual(locateMentions("x@SBIN @SBIN", [{ kind: "instrument", id: "India:SBIN", type: "stock", text: "@SBIN" }]), [{ start: 7, end: 12 }]);
  assert.equal(locateMentions("@SBI", [{ kind: "instrument", id: "India:SBIN", type: "stock", text: "@SBIN" }]), null);
});

/* ------------------------------------------------ 12. replies, likes and the rest are unchanged */

test("a reply can mention too, and still carries its parent's symbols", async () => {
  const { store, inserted } = postStore();
  const out = await resolveMentions([], "plain", null);
  assert.equal(out.ok, true);
  await createPost({ token: "good", body: "Agree, @SBIN too", parentId: POST_ID, mentions: [{ kind: "instrument", id: "India:SBIN", type: "stock", text: "@SBIN" }] }, store, NOW, null, resolver());
  assert.deepEqual(inserted[0].symbols, ["TCS", "SBIN"]);
  assert.equal(inserted[0].sentiment, null);
  assert.equal(inserted[0].community_id, undefined, "the database copies the parent's community");
});

test("a post without mentions doesn't touch the mention columns (works before the migration)", async () => {
  const { store, inserted } = postStore();
  await createPost({ token: "good", body: "Steady quarter", symbol: "TCS" }, store, NOW, null, resolver());
  assert.equal("mentions" in inserted[0], false);
  assert.equal("mention_community_ids" in inserted[0], false);
});
