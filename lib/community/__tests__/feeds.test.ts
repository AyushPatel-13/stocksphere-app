import { test } from "node:test";
import assert from "node:assert/strict";

import { GET as listRoute } from "@/app/api/community/posts/route";
import { isRanked, nextPage, showsNewPost, usesRange, viewParams, type FeedViewState } from "../feedView";
import { getFeed, rangeStart, type CommunityStore, type FeedInput, type ListQuery, type RankQuery } from "../service";
import type { PostView } from "../types";

/** One feed implementation: tabs, sorts, filters and paging. */

const NOW = Date.parse("2026-10-28T12:00:00.000Z");
const VIEWER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FRIEND = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];

function post(id: string): PostView {
  return {
    id,
    body: `post ${id}`,
    sentiment: null,
    symbols: [],
    parentId: null,
    likeCount: 0,
    replyCount: 0,
    createdAt: "2026-10-28T10:00:00.000Z",
    author: { username: "a", displayName: "A", avatarUrl: null, role: "user", stats: { resolved: 0, wins: 0, points: 0 } },
  };
}

function store(overrides: Partial<CommunityStore> = {}): CommunityStore & { ranks: RankQuery[]; lists: ListQuery[] } {
  const ranks: RankQuery[] = [];
  const lists: ListQuery[] = [];
  return {
    ranks,
    lists,
    verifyToken: async (token) => (token === "good" ? VIEWER : null),
    getAuthor: async () => null,
    countPostsSince: async () => 0,
    recentBodies: async () => [],
    getParent: async () => null,
    insertPost: async () => {
      throw new Error("no writes");
    },
    // Returned out of order, as a database might: the feed keeps the rank order.
    listPosts: async (query) => {
      lists.push(query);
      return query.ids ? [...query.ids].reverse().map(post) : [];
    },
    sentiment: async () => ({ bullish: 0, bearish: 0, total: 0 }),
    recentSymbols: async () => [],
    rankPosts: async (query) => {
      ranks.push(query);
      return ids.slice(0, query.limit);
    },
    followees: async () => [FRIEND],
    watchSymbols: async () => ["SBIN"],
    ...overrides,
  };
}

const input = (overrides: Partial<FeedInput>): FeedInput => ({ feed: "latest", viewerId: null, offset: 0, limit: 3, ...overrides });

test("posts come back in rank order, in one read, and page by offset", async () => {
  const s = store();
  const result = await getFeed(s, input({ feed: "trending" }), NOW);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.posts.map((p) => p.id), ids);
  assert.equal(s.lists.length, 1);
  assert.deepEqual(result.ok && [result.hasMore, result.next], [true, "3"]);

  const short = await getFeed(store({ rankPosts: async () => ids.slice(0, 1) }), input({ feed: "trending", offset: 3 }), NOW);
  assert.deepEqual(short.ok && [short.hasMore, short.next], [false, null]);
});

test("For You ranks hot posts, boosting people the viewer follows and stocks they watch", async () => {
  const s = store();
  await getFeed(s, input({ feed: "for-you", viewerId: VIEWER }), NOW);
  assert.deepEqual([s.ranks[0].sort, s.ranks[0].boostAuthors, s.ranks[0].boostSymbols, s.ranks[0].anyAuthors], ["hot", [FRIEND], ["SBIN"], undefined]);

  // Signed out: plain hot, nothing personal.
  const anon = store();
  await getFeed(anon, input({ feed: "for-you" }), NOW);
  assert.deepEqual([anon.ranks[0].sort, anon.ranks[0].boostAuthors, anon.ranks[0].boostSymbols], ["hot", undefined, undefined]);
});

test("Following is only people and watched stocks, newest first, and needs a viewer", async () => {
  const s = store();
  await getFeed(s, input({ feed: "following", viewerId: VIEWER }), NOW);
  assert.deepEqual([s.ranks[0].sort, s.ranks[0].anyAuthors, s.ranks[0].anySymbols], ["new", [FRIEND], ["SBIN"]]);

  const signedOut = await getFeed(store(), input({ feed: "following" }), NOW);
  assert.deepEqual(!signedOut.ok && [signedOut.status, signedOut.code], [401, "SIGNED_OUT"]);

  // Following nobody and watching nothing: an empty feed that says why, not every post.
  const lonely = store({ followees: async () => [], watchSymbols: async () => [] });
  const empty = await getFeed(lonely, input({ feed: "following", viewerId: VIEWER }), NOW);
  assert.deepEqual(empty.ok && [empty.posts, empty.empty], [[], "no-follows"]);
  assert.equal(lonely.ranks.length, 0);
});

test("Top uses votes within a period (a week unless chosen); boards rank within their scope", async () => {
  const s = store();
  await getFeed(s, input({ feed: "top" }), NOW);
  assert.deepEqual([s.ranks[0].sort, s.ranks[0].since], ["top", rangeStart("week", NOW)]);
  await getFeed(s, input({ feed: "top", range: "all" }), NOW);
  assert.equal(s.ranks[1].since, undefined);
  await getFeed(s, input({ sort: "discussed", range: "day", scope: { anySymbols: ["TCS"], anyCommunity: "c1" } }), NOW);
  assert.deepEqual([s.ranks[2].sort, s.ranks[2].since, s.ranks[2].anySymbols, s.ranks[2].anyCommunity], ["discussed", rangeStart("day", NOW), ["TCS"], "c1"]);
  assert.equal(rangeStart("day", NOW), "2026-10-27T12:00:00.000Z");
});

test("filters reach the ranking: sentiment, type and exchange", async () => {
  const s = store();
  await getFeed(s, input({ feed: "trending", sentiment: "bullish", kind: "earnings", exchange: "NSE" }), NOW);
  assert.deepEqual([s.ranks[0].sentiment, s.ranks[0].kind, s.ranks[0].exchange], ["bullish", "earnings", "NSE"]);
});

test("before the ranking migrations, ranked feeds say so instead of failing", async () => {
  const off = store({ rankPosts: async () => Promise.reject(Object.assign(new Error("x"), { code: "NOT_CONFIGURED" })) });
  const result = await getFeed(off, input({ feed: "for-you" }), NOW);
  assert.deepEqual(!result.ok && [result.status, result.code], [503, "NOT_CONFIGURED"]);
  const none = await getFeed(store({ rankPosts: undefined }), input({ feed: "top" }), NOW);
  assert.equal(!none.ok && none.status, 503);
  await assert.rejects(getFeed(store({ rankPosts: async () => Promise.reject(new Error("db down")) }), input({ feed: "top" }), NOW), /db down/);
});

test("the route picks ranked feeds, verifies the viewer from the token, and validates every parameter", async () => {
  const s = store();
  const forYou = await listRoute(new Request("http://x/api/community/posts?feed=for-you", { headers: { Authorization: "Bearer good" } }), undefined, s, null, null, null);
  assert.equal(forYou.status, 200);
  assert.deepEqual(s.ranks[0].boostAuthors, [FRIEND]);

  // A forged token is just a signed-out visitor.
  const forged = store();
  await listRoute(new Request("http://x/api/community/posts?feed=for-you", { headers: { Authorization: "Bearer forged" } }), undefined, forged, null, null, null);
  assert.equal(forged.ranks[0].boostAuthors, undefined);

  const following = await listRoute(new Request("http://x/api/community/posts?feed=following"), undefined, store(), null, null, null);
  assert.equal(following.status, 401);

  // Latest stays the newest-first path (no ranking needed), with the exchange filter.
  const latest = store();
  await listRoute(new Request("http://x/api/community/posts?feed=latest&exchange=bse"), undefined, latest, null, null, null);
  assert.deepEqual([latest.ranks.length, latest.lists[0].exchange], [0, "BSE"]);

  // A board sorted by votes is ranked within the board.
  const board = store();
  await listRoute(new Request("http://x/api/community/posts?symbol=TCS&sort=top&range=month"), undefined, board, null, null, null);
  assert.deepEqual([board.ranks[0].sort, board.ranks[0].anySymbols], ["top", ["TCS"]]);

  for (const bad of ["feed=popular", "sort=best", "range=decade", "exchange=NYSE"]) {
    const response = await listRoute(new Request(`http://x/api/community/posts?${bad}`), undefined, store(), null, null, null);
    assert.equal(response.status, 400, bad);
  }
});

test("feed views: which are ranked, how they page, and where a new post appears", () => {
  const view = (tab: FeedViewState["tab"], sort: FeedViewState["sort"] = "new"): FeedViewState => ({ tab, sort, range: "week" });
  assert.equal(isRanked(view("latest"), false), false);
  assert.equal(isRanked(view("for-you"), false), true);
  assert.equal(isRanked(view("latest", "top"), true), true);
  assert.equal(isRanked(view("trending", "new"), true), false);

  assert.equal(usesRange(view("top"), false), true);
  assert.equal(usesRange(view("latest", "discussed"), true), true);
  assert.deepEqual(viewParams(view("top"), false), { feed: "top", range: "week" });
  assert.deepEqual(viewParams(view("for-you", "hot"), true), { sort: "hot" });
  assert.deepEqual(viewParams(view("for-you", "new"), true), {});

  const posts = [{ createdAt: "2026-10-28T09:00:00.000Z" }];
  assert.deepEqual(nextPage(view("latest"), false, posts, null), { before: "2026-10-28T09:00:00.000Z" });
  assert.deepEqual(nextPage(view("trending"), false, posts, "20"), { offset: "20" });
  assert.equal(nextPage(view("trending"), false, posts, null), null);

  assert.equal(showsNewPost(view("latest"), false), true);
  assert.equal(showsNewPost(view("top"), false), false);
  assert.equal(showsNewPost(view("latest", "discussed"), true), false);
});
