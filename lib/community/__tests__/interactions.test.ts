import { test } from "node:test";
import assert from "node:assert/strict";

import { GET as listRoute, POST as postRoute } from "@/app/api/community/posts/route";
import { attachQuotes, createPost, getProfileFeed, toPostView, type CommunityStore, type ListQuery, type NewPostRow, type ParentRecord } from "../service";
import { buildThread, sortThread } from "../thread";
import type { PostView } from "../types";
import { applyVote, formatScore, nextVote, scoreOf } from "../votes";

/** Stage 4: votes, reply sorting, reposts, quotes and saved posts. */

const NOW = Date.parse("2026-10-28T12:00:00.000Z");
const ROOT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const COMMENT = "33333333-3333-4333-8333-333333333333";
const HIDDEN = "44444444-4444-4444-8444-444444444444";

function post(id: string, extra: Partial<PostView> = {}): PostView {
  return {
    id,
    body: `post ${id.slice(0, 4)}`,
    sentiment: null,
    symbols: [],
    parentId: null,
    likeCount: 0,
    replyCount: 0,
    createdAt: "2026-10-28T10:00:00.000Z",
    author: { username: "a", displayName: "A", avatarUrl: null, role: "user", stats: { resolved: 0, wins: 0, points: 0 } },
    ...extra,
  };
}

/* ------------------------------------------------ votes */

test("one vote per member: click to vote, click again to remove, click the other to switch", () => {
  assert.equal(nextVote(0, 1), 1);
  assert.equal(nextVote(1, 1), 0);
  assert.equal(nextVote(1, -1), -1);
  assert.equal(nextVote(-1, -1), 0);

  const start = { up: 4, down: 1 };
  assert.deepEqual(applyVote(start, 0, 1), { up: 5, down: 1 });
  assert.deepEqual(applyVote(start, 1, -1), { up: 3, down: 2 });
  assert.deepEqual(applyVote(start, -1, 0), { up: 4, down: 0 });
  // A rollback is the same change backwards, so a failed save leaves the counts exactly as they were.
  assert.deepEqual(applyVote(applyVote(start, 1, -1), -1, 1), start);
  assert.deepEqual(applyVote({ up: 0, down: 0 }, 1, 0), { up: 0, down: 0 });
  assert.equal(scoreOf(start), 3);
  assert.deepEqual([formatScore(0), formatScore(-3), formatScore(1250), formatScore(-2_000_000)], ["0", "-3", "1.3k", "-2M"]);
});

test("vote counts are read with posts, and absent before the votes migration", () => {
  const base = { id: ROOT, body: "b", sentiment: null, symbols: [], parent_id: null, like_count: 0, reply_count: 0, created_at: "2026-10-28T10:00:00.000Z", author: null };
  const voted = toPostView({ ...base, up_count: 7, down_count: 2 });
  assert.deepEqual([voted.upCount, voted.downCount], [7, 2]);
  const old = toPostView(base);
  assert.equal("upCount" in old, false);
});

/* ------------------------------------------------ reply sorting */

test("replies sort by Top, New or Oldest at every level without losing any", () => {
  const c = (id: string, parent: string, at: string, up = 0) => post(id, { parentId: parent, rootId: ROOT, createdAt: at, upCount: up, downCount: 0 });
  const comments = [
    c("a0000000-0000-4000-8000-000000000001", ROOT, "2026-10-28T09:00:00Z", 1),
    c("a0000000-0000-4000-8000-000000000002", ROOT, "2026-10-28T10:00:00Z", 5),
    c("a0000000-0000-4000-8000-000000000003", ROOT, "2026-10-28T11:00:00Z", 0),
    c("a0000000-0000-4000-8000-000000000004", "a0000000-0000-4000-8000-000000000001", "2026-10-28T09:30:00Z", 0),
    c("a0000000-0000-4000-8000-000000000005", "a0000000-0000-4000-8000-000000000001", "2026-10-28T09:40:00Z", 3),
  ];
  const tree = buildThread(comments, ROOT);
  const top = sortThread(tree, "top");
  assert.deepEqual(top.map((n) => n.id.slice(-1)), ["2", "1", "3"]);
  assert.deepEqual(top[1].children.map((n) => n.id.slice(-1)), ["5", "4"]);
  assert.deepEqual(sortThread(tree, "new").map((n) => n.id.slice(-1)), ["3", "2", "1"]);
  assert.deepEqual(sortThread(tree, "old").map((n) => n.id.slice(-1)), ["1", "2", "3"]);
  // The input tree isn't changed, and every comment is still there.
  assert.deepEqual(tree.map((n) => n.id.slice(-1)), ["1", "2", "3"]);
  const count = (nodes: typeof tree): number => nodes.reduce((n, node) => n + 1 + count(node.children), 0);
  assert.equal(count(top), comments.length);

  // Without votes, Top reads oldest first, as threads always did.
  const plain = buildThread(comments.map((x) => ({ ...x, upCount: 0 })), ROOT);
  assert.deepEqual(sortThread(plain, "top").map((n) => n.id.slice(-1)), ["1", "2", "3"]);
});

/* ------------------------------------------------ quotes */

function store(overrides: Partial<CommunityStore> = {}): CommunityStore & { inserted: NewPostRow[]; lists: ListQuery[] } {
  const inserted: NewPostRow[] = [];
  const lists: ListQuery[] = [];
  const parents: Record<string, ParentRecord> = {
    [ROOT]: { symbols: [], authorId: "user-2", parentId: null, rootId: null, threads: true },
    [COMMENT]: { symbols: [], authorId: "user-2", parentId: ROOT, rootId: ROOT, threads: true },
  };
  return {
    inserted,
    lists,
    verifyToken: async (token) => (token === "good" ? "user-1" : null),
    getAuthor: async (id) => ({ id, createdAt: "2026-09-01T00:00:00.000Z" }),
    countPostsSince: async () => 0,
    recentBodies: async () => [],
    getParent: async (id) => parents[id] ?? null,
    insertPost: async (row) => {
      inserted.push(row);
      return post(OTHER, { body: row.body, quoteOf: row.quote_of ?? null, repostCount: 0 });
    },
    listPosts: async (query) => {
      lists.push(query);
      return (query.ids ?? []).filter((id) => id !== HIDDEN).map((id) => post(id));
    },
    sentiment: async () => ({ bullish: 0, bearish: 0, total: 0 }),
    recentSymbols: async () => [],
    ...overrides,
  };
}

test("a quote post quotes a visible top-level post, never a comment, a hidden post or as a reply", async () => {
  const s = store();
  const ok = await createPost({ token: "good", body: "Agree with this", quoteOf: ROOT }, s, NOW);
  assert.equal(ok.ok, true);
  assert.equal(s.inserted[0].quote_of, ROOT);

  const cases: [Record<string, unknown>, number][] = [
    [{ quoteOf: COMMENT }, 400],
    [{ quoteOf: HIDDEN }, 404],
    [{ quoteOf: "not-a-uuid" }, 400],
    [{ quoteOf: ROOT, parentId: ROOT, postId: ROOT }, 400],
  ];
  for (const [extra, status] of cases) {
    const result = await createPost({ token: "good", body: "Quoting", ...extra }, s, NOW);
    assert.equal(!result.ok && result.status, status, JSON.stringify(extra));
  }
  assert.equal(s.inserted.length, 1);

  // A plain post writes no quote column (it works before the migration).
  await createPost({ token: "good", body: "Plain" }, s, NOW);
  assert.equal("quote_of" in s.inserted[1], false);

  // Before the migration a quote is a clear 503, not a silent plain post.
  const off = store({ insertPost: async () => Promise.reject(Object.assign(new Error("no column"), { code: "PGRST204" })) });
  const result = await createPost({ token: "good", body: "Quoting", quoteOf: ROOT }, off, NOW);
  assert.deepEqual(!result.ok && [result.status, result.code], [503, "NOT_CONFIGURED"]);
});

test("quoted posts are attached in one read per page; a hidden original shows as unavailable", async () => {
  const s = store();
  const page = [post("q1000000-0000-4000-8000-000000000001", { quoteOf: ROOT }), post("q2000000-0000-4000-8000-000000000002", { quoteOf: ROOT }), post("q3000000-0000-4000-8000-000000000003", { quoteOf: HIDDEN }), post("q4000000-0000-4000-8000-000000000004")];
  const out = await attachQuotes(s, page);
  assert.equal(s.lists.length, 1);
  assert.deepEqual(s.lists[0].ids, [ROOT, HIDDEN]);
  assert.equal(out[0].quoted?.id, ROOT);
  assert.equal(out[2].quoted, null);
  assert.equal("quoted" in out[3], false);

  // No quotes on the page: no extra read.
  const quiet = store();
  await attachQuotes(quiet, [post(ROOT)]);
  assert.equal(quiet.lists.length, 0);
});

test("the route passes quoteOf through and attaches the quoted post to the response", async () => {
  const s = store();
  const response = await postRoute(
    new Request("http://x/api/community/posts", {
      method: "POST",
      headers: { Authorization: "Bearer good", "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Quoting this", quoteOf: ROOT }),
    }),
    undefined,
    s,
    null,
    null,
    null
  );
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.post.quoted.id, ROOT);
});

/* ------------------------------------------------ saved posts and reposts tab */

test("the Saved page's lookup returns posts in the order asked, skipping hidden ones, and validates ids", async () => {
  const s = store();
  const ok = await listRoute(new Request(`http://x/api/community/posts?ids=${OTHER},${HIDDEN},${ROOT}`), undefined, s, null, null, null);
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).posts.map((p: PostView) => p.id), [OTHER, ROOT]);

  for (const bad of ["ids=nope", `ids=${Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`).join(",")}`]) {
    const response = await listRoute(new Request(`http://x/api/community/posts?${bad}`), undefined, s, null, null, null);
    assert.equal(response.status, 400);
  }
});

test("a profile's Reposts tab lists reposted posts in repost order, and says when reposts aren't on", async () => {
  const s = store({
    profileId: async () => "user-1",
    reposts: async () => [
      { postId: ROOT, likedAt: "2026-10-28T11:00:00Z" },
      { postId: HIDDEN, likedAt: "2026-10-28T10:00:00Z" },
      { postId: OTHER, likedAt: "2026-10-28T09:00:00Z" },
    ],
  });
  const result = await getProfileFeed(s, { username: "ayush", tab: "reposts", limit: 3 });
  assert.deepEqual(result.ok && [result.posts.map((p) => p.id), result.next], [[ROOT, OTHER], "2026-10-28T09:00:00Z"]);

  const off = await getProfileFeed(store({ profileId: async () => "user-1", reposts: async () => Promise.reject(Object.assign(new Error("x"), { code: "NOT_CONFIGURED" })) }), { username: "ayush", tab: "reposts", limit: 3 });
  assert.deepEqual(!off.ok && [off.status, off.code], [503, "NOT_CONFIGURED"]);
});

test("repost counts and quote links are read only for top-level posts, and only after the migration", () => {
  const base = { id: ROOT, body: "b", sentiment: null, symbols: [], like_count: 0, reply_count: 0, created_at: "2026-10-28T10:00:00.000Z", author: null };
  const top = toPostView({ ...base, parent_id: null, repost_count: 2, quote_of: OTHER });
  assert.deepEqual([top.repostCount, top.quoteOf], [2, OTHER]);
  const comment = toPostView({ ...base, parent_id: ROOT, root_id: ROOT, repost_count: 0, quote_of: null });
  assert.equal("repostCount" in comment, false);
  assert.equal("repostCount" in toPostView({ ...base, parent_id: null }), false);
});
