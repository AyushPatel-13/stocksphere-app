import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createPost,
  getTrending,
  type CommunityStore,
  type NewPostRow,
} from "../service";
import type { PostView } from "../types";
import { GET as listRoute, POST as postRoute } from "@/app/api/community/posts/route";

const NOW = Date.parse("2026-10-19T08:00:00.000Z");
const OLD_ACCOUNT = "2026-09-01T00:00:00.000Z";
const NEW_ACCOUNT = "2026-10-18T00:00:00.000Z";
const PARENT = "11111111-1111-4111-8111-111111111111";

function view(row: NewPostRow): PostView {
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
  };
}

function store(overrides: Partial<CommunityStore> = {}): CommunityStore & { inserted: NewPostRow[] } {
  const inserted: NewPostRow[] = [];
  return {
    inserted,
    verifyToken: async (token) => (token === "good" ? "user-1" : null),
    getAuthor: async (id) => (id === "user-1" ? { id, createdAt: OLD_ACCOUNT } : null),
    countPostsSince: async () => 0,
    recentBodies: async () => [],
    getParent: async (id) => (id === PARENT ? { symbols: ["TCS"] } : null),
    insertPost: async (row) => {
      inserted.push(row);
      return view(row);
    },
    listPosts: async () => [],
    sentiment: async () => ({ bullish: 0, bearish: 0, total: 0 }),
    recentSymbols: async () => [],
    ...overrides,
  };
}

test("a valid post on a board is stored with the board and its cashtags", async () => {
  const s = store();
  const result = await createPost(
    { token: "good", body: "Margins look better than $INFY", sentiment: "bullish", symbol: "tcs" },
    s,
    NOW
  );

  assert.equal(result.ok, true);
  assert.deepEqual(s.inserted[0], {
    author_id: "user-1",
    body: "Margins look better than $INFY",
    sentiment: "bullish",
    symbols: ["TCS", "INFY"],
    parent_id: null,
  });
});

test("not configured, signed out, bad token and missing profile are each reported plainly", async () => {
  assert.equal((await createPost({ token: "good", body: "x" }, null, NOW) as { status: number }).status, 503);
  assert.equal((await createPost({ token: null, body: "x" }, store(), NOW) as { status: number }).status, 401);
  assert.equal((await createPost({ token: "bad", body: "x" }, store(), NOW) as { status: number }).status, 401);

  const noProfile = await createPost(
    { token: "good", body: "hello" },
    store({ getAuthor: async () => null }),
    NOW
  );
  assert.deepEqual([noProfile.ok, (noProfile as { code?: string }).code], [false, "NO_PROFILE"]);
});

test("spam rules, rate limits and duplicates stop a post before it is stored", async () => {
  const s = store();
  const spam = await createPost({ token: "good", body: "Join my telegram channel for calls" }, s, NOW);
  assert.equal((spam as { status: number }).status, 422);

  const limited = await createPost(
    { token: "good", body: "hello there" },
    store({ countPostsSince: async () => 8 }),
    NOW
  );
  assert.equal((limited as { status: number }).status, 429);

  const duplicate = await createPost(
    { token: "good", body: "TCS looks strong" },
    store({ recentBodies: async () => ["tcs looks  strong!"] }),
    NOW
  );
  assert.equal((duplicate as { code?: string }).code, "DUPLICATE");

  assert.equal(s.inserted.length, 0);
});

test("new accounts can't post links; older ones can", async () => {
  const body = "Worth reading https://example.com/q2-review";

  const fresh = await createPost(
    { token: "good", body },
    store({ getAuthor: async (id) => ({ id, createdAt: NEW_ACCOUNT }) }),
    NOW
  );
  assert.equal((fresh as { status: number }).status, 422);

  const old = await createPost({ token: "good", body }, store(), NOW);
  assert.equal(old.ok, true);
});

test("replies inherit the parent's stocks and never carry a sentiment", async () => {
  const s = store();
  const reply = await createPost(
    { token: "good", body: "Agree, and $INFY too", sentiment: "bearish", parentId: PARENT, symbol: "HDFCBANK" },
    s,
    NOW
  );

  assert.equal(reply.ok, true);
  assert.equal(s.inserted[0].sentiment, null);
  assert.equal(s.inserted[0].parent_id, PARENT);
  assert.deepEqual(s.inserted[0].symbols, ["TCS", "INFY"]);

  const orphan = await createPost(
    { token: "good", body: "reply", parentId: "33333333-3333-4333-8333-333333333333" },
    s,
    NOW
  );
  assert.equal((orphan as { status: number }).status, 404);
});

test("trending counts each post once per stock, most discussed first", async () => {
  const trending = await getTrending(
    store({ recentSymbols: async () => [["TCS", "INFY"], ["TCS"], ["TCS", "TCS"], ["HDFCBANK"]] }),
    NOW
  );

  assert.deepEqual(trending.slice(0, 2), [
    { symbol: "TCS", posts: 3 },
    { symbol: "HDFCBANK", posts: 1 },
  ]);
});

test("routes: bearer token is read, failures map to status codes, inputs are validated", async () => {
  const s = store();

  const created = await postRoute(
    new Request("http://x/api/community/posts", {
      method: "POST",
      headers: { Authorization: "Bearer good", "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Nice quarter for $TCS" }),
    }),
    undefined,
    s
  );
  assert.equal(created.status, 201);

  const unauth = await postRoute(
    new Request("http://x/api/community/posts", { method: "POST", body: JSON.stringify({ body: "hi" }) }),
    undefined,
    s
  );
  assert.equal(unauth.status, 401);

  const notSetUp = await listRoute(new Request("http://x/api/community/posts"), undefined, null);
  assert.equal(notSetUp.status, 503);

  const badSymbol = await listRoute(new Request("http://x/api/community/posts?symbol=%3Cscript%3E"), undefined, s);
  assert.equal(badSymbol.status, 400);

  const ok = await listRoute(new Request("http://x/api/community/posts?symbol=tcs&limit=999"), undefined, s);
  assert.equal(ok.status, 200);
});

/* ------------------------------------------------------------ moderation */

import { groupReports, listReported, moderatePost, type ModerationStore } from "../moderation";
import { GET as moderationGet, POST as moderationPost } from "@/app/api/community/moderation/route";

function modStore(role: string | null) {
  const hidden: [string, boolean, string | null][] = [];
  const store: ModerationStore = {
    verifyToken: async (token) => (token === "good" ? "m1" : null),
    roleOf: async () => role,
    reported: async () => [],
    setHidden: async (postId, value, reason) => {
      hidden.push([postId, value, reason]);
      return postId !== "00000000-0000-4000-8000-000000000404";
    },
  };
  return { store, hidden };
}

const POST_ID = "00000000-0000-4000-8000-000000000001";

test("only moderators and admins can use the queue", async () => {
  assert.equal((await listReported(null, modStore("moderator").store)).ok, false);
  const user = await listReported("good", modStore("user").store);
  assert.equal(!user.ok && user.status, 403);
  assert.equal((await listReported("good", modStore("moderator").store)).ok, true);
  assert.equal((await listReported("good", modStore("admin").store)).ok, true);
  const off = await listReported("good", null);
  assert.equal(!off.ok && off.code, "NOT_CONFIGURED");
});

test("hide and restore", async () => {
  const { store, hidden } = modStore("moderator");
  const hide = await moderatePost("good", { postId: POST_ID, action: "hide", reason: "  pump  " }, store);
  assert.deepEqual(hide.ok && hide.value, { postId: POST_ID, hidden: true });
  await moderatePost("good", { postId: POST_ID, action: "restore" }, store);
  assert.deepEqual(hidden, [[POST_ID, true, "pump"], [POST_ID, false, null]]);

  const status = async (input: Record<string, unknown>) => {
    const r = await moderatePost("good", input, store);
    return r.ok ? 200 : r.status;
  };
  assert.equal(await status({ postId: "x", action: "hide" }), 400);
  assert.equal(await status({ postId: POST_ID, action: "delete" }), 400);
  assert.equal(await status({ postId: "00000000-0000-4000-8000-000000000404", action: "hide" }), 404);
  const user = await moderatePost("good", { postId: POST_ID, action: "hide" }, modStore("user").store);
  assert.equal(!user.ok && user.status, 403);
});

test("reports group per post with reason counts", () => {
  const grouped = groupReports([
    { post_id: "a", reason: "spam", created_at: "2026-10-20T01:00:00Z" },
    { post_id: "a", reason: "tips", created_at: "2026-10-20T03:00:00Z" },
    { post_id: "a", reason: "spam", created_at: "2026-10-20T02:00:00Z" },
    { post_id: "b", reason: "abuse", created_at: "2026-10-20T00:00:00Z" },
  ]);
  assert.deepEqual(grouped.get("a"), { reports: 3, reasons: { spam: 2, tips: 1 }, last: "2026-10-20T03:00:00Z" });
  assert.equal(grouped.get("b")?.reports, 1);
});

test("moderation routes pass the bearer token through", async () => {
  const { store } = modStore("moderator");
  const ok = await moderationGet(new Request("http://x", { headers: { Authorization: "Bearer good" } }), undefined, store);
  assert.equal(ok.status, 200);
  assert.equal((await moderationGet(new Request("http://x"), undefined, store)).status, 401);
  const acted = await moderationPost(
    new Request("http://x", { method: "POST", headers: { Authorization: "Bearer good" }, body: JSON.stringify({ postId: POST_ID, action: "hide" }) }),
    undefined,
    store
  );
  assert.equal(acted.status, 200);
  assert.equal((await moderationPost(new Request("http://x", { method: "POST", body: "{bad" }), undefined, store)).status, 400);
});
