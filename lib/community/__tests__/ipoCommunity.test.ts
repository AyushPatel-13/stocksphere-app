import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  boardSymbols,
  communityScope,
  ipoCommunityPath,
  listingOfBoard,
  stockBoardSymbol,
  stockPath,
  supabaseDirectory,
  type Community,
} from "../communities";
import { communityResolver, getIpoCommunityPage, lookupIpo, clearIpoLookupCache } from "../ipoCommunity";
import { createPost, scopeFilter, type CommunityStore, type ListQuery, type NewPostRow } from "../service";
import type { PostView } from "../types";
import { GET as postsRoute, POST as postRoute } from "@/app/api/community/posts/route";
import { GET as sentimentRoute } from "@/app/api/community/sentiment/route";
import { GET as ipoRoute } from "@/app/api/community/ipo/route";
import { GET as resolveRoute } from "@/app/api/community/resolve/route";
import { LINKED, NOW, fakeSupabase, lookupFrom, memoryDirectory, upstoxDetailBody } from "./fakes";

const IPO = "tonbo-imaging-india-ipo";
const PARENT = "11111111-1111-4111-8111-111111111111";

function postStore(overrides: Partial<CommunityStore> = {}) {
  const inserted: NewPostRow[] = [];
  const listed: ListQuery[] = [];
  const sentiments: unknown[] = [];
  const store: CommunityStore = {
    verifyToken: async (token) => (token === "good" ? "user-1" : null),
    getAuthor: async (id) => ({ id, createdAt: "2026-09-01T00:00:00.000Z" }),
    countPostsSince: async () => 0,
    recentBodies: async () => [],
    getParent: async (id) => (id === PARENT ? { symbols: [] } : null),
    insertPost: async (row) => {
      inserted.push(row);
      return {
        id: "22222222-2222-4222-8222-222222222222",
        body: row.body,
        sentiment: row.sentiment,
        symbols: row.symbols,
        parentId: row.parent_id,
        likeCount: 0,
        replyCount: 0,
        createdAt: new Date(NOW).toISOString(),
        author: { username: "ayush", displayName: "Ayush", avatarUrl: null, role: "user", stats: { resolved: 0, wins: 0, points: 0 } },
      } satisfies PostView;
    },
    listPosts: async (query) => {
      listed.push(query);
      return [];
    },
    sentiment: async (scope) => {
      sentiments.push(scope);
      return { bullish: 2, bearish: 1, total: 4 };
    },
    recentSymbols: async () => [],
    ...overrides,
  };
  return { store, inserted, listed, sentiments };
}

const bodies = { [IPO]: upstoxDetailBody() };

/* ------------------------------------------------ AC1: Community action on every IPO card */

test("AC1: every IPO card links to its community at a stable URL, whatever its section", () => {
  for (const id of ["core4-ipo", "tonbo-imaging-india-ipo", "flipkart-ipo"]) {
    assert.equal(ipoCommunityPath(id), `/community/ipo/${id}`);
  }
  // The action is rendered by IpoCard itself, for every row (no section condition around it).
  const source = readFileSync("components/Markets/IpoBoard.tsx", "utf8");
  const card = source.slice(source.indexOf("function IpoCard("), source.indexOf("/* ------------------------------------------------------------ page */"));
  assert.match(card, /href=\{ipoCommunityPath\(row\.id\)\}/);
  assert.doesNotMatch(card, /row\.section\s*(===|!==)[^\n]*\n[^\n]*ipoCommunityPath/);
});

/* ------------------------------------------------ AC2: header shows real IPO details only */

test("AC2: the community header uses Upstox's figures, marks it not yet listed, and invents nothing", async () => {
  const page = await getIpoCommunityPage(IPO, memoryDirectory(), lookupFrom(bodies));
  assert.equal(page.ipo?.name, "Tonbo Imaging India IPO");
  assert.equal(page.ipo?.isin, "INE0TON01017");
  assert.deepEqual(page.ipo?.priceBand, { low: 300, high: 316 });
  assert.equal(page.ipo?.subscription, 96.63);
  assert.equal(page.ipo?.listingPrice, null); // Upstox sent none: stays null, never a guess
  assert.equal(page.community, null); // nobody has posted yet — visiting creates nothing
  assert.equal("gmp" in (page.ipo ?? {}), false);

  // Upstox down: the details are missing with the reason, the community still answers.
  const directory = memoryDirectory([{ ...LINKED, type: "ipo", exchange: null, symbol: null, listedAt: null }]);
  const down = await getIpoCommunityPage(IPO, directory, lookupFrom({ [IPO]: "auth" }));
  assert.equal(down.ipo, null);
  assert.equal(down.ipoError?.code, "auth");
  assert.equal(down.community?.type, "ipo");

  // Before the migration: says so instead of failing.
  const unmigrated = memoryDirectory();
  unmigrated.byIpoId = async () => {
    throw { code: "PGRST205" };
  };
  assert.equal((await getIpoCommunityPage(IPO, unmigrated, lookupFrom(bodies))).communityStatus, "not_configured");

  // The route: bad id → 400; unknown IPO with no community → 404.
  assert.equal((await ipoRoute(new Request("http://x/api/community/ipo?id=../etc"), undefined, memoryDirectory(), lookupFrom(bodies))).status, 400);
  assert.equal((await ipoRoute(new Request("http://x/api/community/ipo?id=nope-ipo"), undefined, memoryDirectory(), lookupFrom({}))).status, 404);
});

test("lookupIpo refuses a detail that names a different issue", async () => {
  clearIpoLookupCache();
  const result = await lookupIpo(IPO, async () => ({ ok: true, body: upstoxDetailBody({ id: "other-ipo" }) }), () => NOW);
  assert.equal(result.ok, false);
  clearIpoLookupCache();
});

/* ------------------------------------------------ AC3: first post creates one community, never two */

test("AC3: the first post creates the IPO community from verified Upstox data; later posts reuse it", async () => {
  const directory = memoryDirectory();
  const calls: string[] = [];
  const resolver = communityResolver(directory, lookupFrom(bodies, calls));
  const { store, inserted } = postStore();

  const first = await createPost({ token: "good", body: "Applied for two lots", sentiment: "bullish", ipoId: IPO }, store, NOW, resolver);
  const second = await createPost({ token: "good", body: "Allotment status is out", ipoId: IPO }, store, NOW, resolver);

  assert.equal(first.ok && second.ok, true);
  assert.equal(directory.rows.size, 1);
  assert.deepEqual(directory.created, [{ ipoId: IPO, isin: "INE0TON01017", name: "Tonbo Imaging India IPO", board: "mainboard" }]);
  assert.equal(calls.length, 1, "Upstox is asked only until the community exists");
  const id = [...directory.rows.keys()][0];
  assert.deepEqual(inserted.map((row) => row.community_id), [id, id]);
  // Not listed: the unverified Upstox "symbol" field is never used as a ticker.
  assert.deepEqual(inserted[0].symbols, []);
});

test("AC3: concurrent first posts share one community (unique keys in the database)", async () => {
  // supabaseDirectory.ensureIpo: the insert loses the race (23505) and returns the winner's row.
  const winner = { id: LINKED.id, type: "ipo", name: LINKED.name, isin: LINKED.isin, upstox_ipo_id: IPO, board: "mainboard", exchange: null, symbol: null, listed_at: null };
  let selects = 0;
  const { client, queries } = fakeSupabase((q) => {
    if (q.op === "insert") return { data: null, error: { code: "23505" } };
    selects++;
    return { data: selects > 2 ? winner : null, error: null };
  });
  const community = await supabaseDirectory(client, client).ensureIpo({ ipoId: IPO, isin: LINKED.isin, name: LINKED.name, board: "mainboard" });
  assert.equal(community.id, LINKED.id);
  assert.equal(queries.filter((q) => q.op === "insert").length, 1);
});

test("AC3: no community is created when the IPO can't be verified", async () => {
  const directory = memoryDirectory();
  const { store, inserted } = postStore();

  const unknown = await createPost({ token: "good", body: "Is this real?", ipoId: "made-up-ipo" }, store, NOW, communityResolver(directory, lookupFrom({})));
  assert.deepEqual(unknown.ok ? null : unknown.status, 404);

  const down = await createPost({ token: "good", body: "Upstox down", ipoId: IPO }, store, NOW, communityResolver(directory, lookupFrom({ [IPO]: "timeout" })));
  assert.deepEqual(down.ok ? null : [down.status, down.code], [503, "IPO_UNAVAILABLE"]);

  const bad = await createPost({ token: "good", body: "Path trick", ipoId: "../x" }, store, NOW, communityResolver(directory, lookupFrom(bodies)));
  assert.deepEqual(bad.ok ? null : bad.status, 400);

  const off = await createPost({ token: "good", body: "Not switched on", ipoId: IPO }, store, NOW, null);
  assert.deepEqual(off.ok ? null : off.code, "NOT_CONFIGURED");

  assert.equal(directory.rows.size, 0);
  assert.equal(inserted.length, 0);
});

test("AC3: spam rules still run before an IPO community is created", async () => {
  const directory = memoryDirectory();
  const { store } = postStore();
  const result = await createPost({ token: "good", body: "Join my telegram channel for sure-shot tips", ipoId: IPO }, store, NOW, communityResolver(directory, lookupFrom(bodies)));
  assert.equal(result.ok, false);
  assert.equal(directory.rows.size, 0);
});

/* ------------------------------------------------ AC4: replies stay in their parent's community */

test("AC4: a reply never resolves or picks a community itself (the database copies the parent's)", async () => {
  let asked = 0;
  const resolver = communityResolver(memoryDirectory(), async (id) => {
    asked++;
    return lookupFrom(bodies)(id);
  });
  const { store, inserted } = postStore();
  const result = await createPost({ token: "good", body: "Agreed", parentId: PARENT, ipoId: IPO }, store, NOW, resolver);
  assert.equal(result.ok, true);
  assert.equal(asked, 0);
  assert.equal("community_id" in inserted[0], false);
  assert.equal(inserted[0].sentiment, null);

  const sql = readFileSync("supabase/migrations/20261024000200_communities.sql", "utf8");
  assert.match(sql, /create trigger posts_inherit_community\s+before insert on public\.posts/);
});

/* ------------------------------------------------ AC5: the IPO feed lists the community's posts */

test("AC5: GET ?ipo= lists the community's posts; an IPO nobody posted in is empty", async () => {
  const directory = memoryDirectory([{ ...LINKED, type: "ipo", exchange: null, symbol: null, listedAt: null }]);
  const { store, listed } = postStore();

  const response = await postsRoute(new Request(`http://x/api/community/posts?ipo=${IPO}&sentiment=bullish`), undefined, store, communityResolver(directory));
  assert.equal(response.status, 200);
  assert.deepEqual(listed[0].community, { communityId: LINKED.id, anySymbols: [] });
  assert.equal(listed[0].sentiment, "bullish");

  const empty = await postsRoute(new Request("http://x/api/community/posts?ipo=other-ipo"), undefined, store, communityResolver(directory));
  assert.deepEqual(await empty.json(), { success: true, posts: [], hasMore: false });
  assert.equal(listed.length, 1);

  const sentiment = await sentimentRoute(new Request(`http://x/api/community/sentiment?ipo=${IPO}`), undefined, store, communityResolver(directory));
  assert.equal((await sentiment.json()).bullish, 2);
});

test("POST route passes ipoId through to the community resolver", async () => {
  const directory = memoryDirectory();
  const { store, inserted } = postStore();
  const response = await postRoute(
    new Request("http://x/api/community/posts", {
      method: "POST",
      headers: { Authorization: "Bearer good", "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Subscribed on day one", ipoId: IPO }),
    }),
    undefined,
    store,
    communityResolver(directory, lookupFrom(bodies))
  );
  assert.equal(response.status, 201);
  assert.equal(inserted[0].community_id, [...directory.rows.keys()][0]);
});

/* ------------------------------------------------ AC6: existing stock boards don't regress */

test("AC6: a stock with no linked community reads and writes by symbol exactly as before", async () => {
  const { store, listed, inserted, sentiments } = postStore();

  for (const resolver of [null, communityResolver(memoryDirectory())]) {
    await postsRoute(new Request("http://x/api/community/posts?symbol=tcs"), undefined, store, resolver);
    await sentimentRoute(new Request("http://x/api/community/sentiment?symbol=TCS"), undefined, store, resolver);
    await createPost({ token: "good", body: "Steady quarter", symbol: "TCS" }, store, NOW, resolver);
  }
  assert.deepEqual(listed.map((q) => [q.symbol, q.community]), [["TCS", undefined], ["TCS", undefined]]);
  assert.deepEqual(sentiments, ["TCS", "TCS"]);
  assert.deepEqual(inserted.map((row) => [row.symbols, "community_id" in row]), [[["TCS"], false], [["TCS"], false]]);

  // A broken or unmigrated communities table never breaks a stock board.
  const broken = memoryDirectory();
  broken.byListing = async () => {
    throw { code: "42P01" };
  };
  await postsRoute(new Request("http://x/api/community/posts?symbol=TCS"), undefined, store, communityResolver(broken));
  assert.equal(listed.at(-1)?.community, undefined);
});

/* ------------------------------------------------ AC10: the stock page resolves to the same record */

test("AC10: after listing, the stock board and the IPO URL read the same community", async () => {
  const directory = memoryDirectory([LINKED]);
  const resolver = communityResolver(directory);
  const { store, listed, inserted } = postStore();

  // Stock board for the new listing (any spelling) includes the IPO community's posts.
  await postsRoute(new Request("http://x/api/community/posts?symbol=TONBO.NS"), undefined, store, resolver);
  assert.deepEqual(listed[0].community, { communityId: LINKED.id, anySymbols: ["TONBO.NS", "TONBO"] });

  // The IPO URL still works and reads the same posts plus the ticker's.
  await postsRoute(new Request(`http://x/api/community/posts?ipo=${IPO}`), undefined, store, resolver);
  assert.deepEqual(listed[1].community, { communityId: LINKED.id, anySymbols: ["TONBO", "TONBO.NS"] });

  // A post on either is filed under the one community.
  await createPost({ token: "good", body: "Listing day pop", symbol: "TONBO.NS" }, store, NOW, resolver);
  await createPost({ token: "good", body: "Holding for the long term", ipoId: IPO }, store, NOW, resolver);
  assert.deepEqual(inserted.map((row) => row.community_id), [LINKED.id, LINKED.id]);
  assert.deepEqual(inserted[1].symbols, ["TONBO.NS"]);

  // The stock page's Community link, and the IPO page's stock link.
  const resolved = await (await resolveRoute(new Request("http://x/api/community/resolve?symbol=TONBO.NS"), undefined, resolver)).json();
  assert.equal(resolved.community.id, LINKED.id);
  assert.equal(ipoCommunityPath(resolved.community.ipoId), `/community/ipo/${IPO}`);
  const page = await getIpoCommunityPage(IPO, directory, lookupFrom({}));
  assert.equal(page.community?.stockPath, "/stock/TONBO.NS");

  // Unlinked stocks have none.
  const none = await (await resolveRoute(new Request("http://x/api/community/resolve?symbol=TCS"), undefined, resolver)).json();
  assert.equal(none.community, null);
});

/* ------------------------------------------------ helpers */

test("board symbols map to listings without guessing exchanges", () => {
  assert.deepEqual(listingOfBoard("tonbo"), { exchange: "NSE", symbol: "TONBO" });
  assert.deepEqual(listingOfBoard("TONBO.NS"), { exchange: "NSE", symbol: "TONBO" });
  assert.deepEqual(listingOfBoard("TONBO.BSE"), { exchange: "BSE", symbol: "TONBO" });
  assert.deepEqual(listingOfBoard("TONBO.BO"), { exchange: "BSE", symbol: "TONBO" });
  assert.deepEqual(listingOfBoard("M&M"), { exchange: "NSE", symbol: "M&M" });
  assert.equal(listingOfBoard("BRK.B"), null);
  assert.deepEqual(boardSymbols("BSE", "X"), ["X.BSE", "X.BO"]);
  assert.equal(stockBoardSymbol("NSE", "TCS"), "TCS");
  assert.equal(stockBoardSymbol("NSE", "TONBO"), "TONBO.NS");
  assert.equal(stockBoardSymbol("BSE", "TONBO"), "TONBO.BSE");
  const ipoOnly: Community = { ...LINKED, type: "ipo", exchange: null, symbol: null, listedAt: null };
  assert.equal(stockPath(ipoOnly), null);
  assert.deepEqual(communityScope(ipoOnly).anySymbols, []);
});

test("the feed filter can't be broken out of", () => {
  assert.equal(
    scopeFilter({ communityId: LINKED.id, anySymbols: ["TONBO", "M&M", "x,y)", 'a"b'] }),
    `community_id.eq.${LINKED.id},symbols.ov.{"TONBO","M&M"}`
  );
  assert.throws(() => scopeFilter({ communityId: "1),or(true", anySymbols: [] }));
});
