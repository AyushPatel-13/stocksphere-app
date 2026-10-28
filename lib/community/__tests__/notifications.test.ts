import { test } from "node:test";
import assert from "node:assert/strict";

import type { StoredMention } from "../mentions";
import { MAX_USER_MENTIONS, createPost, postNotification, userHandles, type CommunityStore, type NewPostRow, type ParentRecord, type ReplyNotification } from "../service";
import type { PostView } from "../types";

/** Stage 5: who hears about a new post — the author answered, the author quoted, and @mentioned members. */

const NOW = Date.parse("2026-10-28T12:00:00.000Z");
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RAVI = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEERA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const POST = "11111111-1111-4111-8111-111111111111";
const NEW_ID = "22222222-2222-4222-8222-222222222222";

test("@handles are read from the text, never from inside a stock tag or an email address", () => {
  const sbin: StoredMention = { kind: "instrument", id: "India:SBIN", type: "stock", symbol: "SBIN", exchange: "NSE", name: "SBI", href: "/stock/SBIN", start: 0, end: 5 };
  assert.deepEqual(userHandles("@SBIN looks cheap, what do @Ravi and @meera_k think? mail me@example.com", [sbin]), ["ravi", "meera_k"]);
  assert.deepEqual(userHandles("@ravi @RAVI @ravi"), ["ravi"]);
  assert.deepEqual(userHandles("@ab is too short, @9lives starts with a digit"), []);
  assert.equal(userHandles(Array.from({ length: 9 }, (_, i) => `@member${i}`).join(" ")).length, MAX_USER_MENTIONS);
});

function view(row: NewPostRow): PostView {
  return {
    id: NEW_ID,
    body: row.body,
    sentiment: null,
    symbols: [],
    parentId: row.parent_id,
    likeCount: 0,
    replyCount: 0,
    createdAt: new Date(NOW).toISOString(),
    author: { username: "ayush", displayName: "Ayush", avatarUrl: null, role: "user", stats: { resolved: 0, wins: 0, points: 0 } },
  };
}

function store(overrides: Partial<CommunityStore> = {}): CommunityStore & { sent: ReplyNotification[] } {
  const sent: ReplyNotification[] = [];
  const parents: Record<string, ParentRecord> = { [POST]: { symbols: [], authorId: RAVI, parentId: null, rootId: null, threads: true } };
  return {
    sent,
    verifyToken: async (token) => (token === "good" ? ME : null),
    getAuthor: async (id) => ({ id, createdAt: "2026-09-01T00:00:00.000Z" }),
    countPostsSince: async () => 0,
    recentBodies: async () => [],
    getParent: async (id) => parents[id] ?? null,
    insertPost: async (row) => view(row),
    listPosts: async () => [],
    sentiment: async () => ({ bullish: 0, bearish: 0, total: 0 }),
    recentSymbols: async () => [],
    notify: async (row) => {
      sent.push(row);
    },
    profilesByHandle: async (handles) =>
      [
        { id: RAVI, username: "ravi" },
        { id: MEERA, username: "meera" },
        { id: ME, username: "ayush" },
      ].filter((p) => handles.includes(p.username)),
    ...overrides,
  };
}

test("mentioning real members notifies each once; unknown handles and yourself are skipped", async () => {
  const s = store();
  const result = await createPost({ token: "good", body: "What do @meera and @nobody_here think? cc @ayush @Meera" }, s, NOW);
  assert.equal(result.ok, true);
  assert.deepEqual(s.sent.map((n) => [n.user_id, n.title, n.link]), [[MEERA, "@ayush mentioned you", `/community/post/${NEW_ID}`]]);
});

test("a reply that mentions the author it answers tells them once, as a reply", async () => {
  const s = store();
  await createPost({ token: "good", body: "Fair point @ravi", parentId: POST, postId: POST }, s, NOW);
  assert.deepEqual(s.sent.map((n) => [n.user_id, n.title]), [[RAVI, "@ayush replied to your post"]]);
  assert.equal(s.sent[0].link, `/community/post/${POST}?comment=${NEW_ID}`);
});

test("quoting a post tells its author; mentioning them too doesn't double up", async () => {
  const s = store();
  await createPost({ token: "good", body: "Exactly this, @ravi and @meera", quoteOf: POST }, s, NOW);
  assert.deepEqual(s.sent.map((n) => [n.user_id, n.title]), [
    [RAVI, "@ayush quoted your post"],
    [MEERA, "@ayush mentioned you"],
  ]);
});

test("a failed lookup or notification never fails the post", async () => {
  const lookupDown = store({ profilesByHandle: async () => Promise.reject(new Error("db down")) });
  assert.equal((await createPost({ token: "good", body: "hey @meera" }, lookupDown, NOW)).ok, true);
  assert.equal(lookupDown.sent.length, 0);

  const notifyDown = store({ notify: async () => Promise.reject(new Error("table missing")) });
  assert.equal((await createPost({ token: "good", body: "hey @meera", quoteOf: POST }, notifyDown, NOW)).ok, true);
});

test("notification text is trimmed and links to the post or the comment", () => {
  const post = view({ author_id: ME, body: `  ${"word ".repeat(80)}  `, sentiment: null, symbols: [], parent_id: null });
  const top = postNotification(RAVI, "@ayush mentioned you", post, null);
  assert.equal(top.link, `/community/post/${NEW_ID}`);
  assert.ok(top.body.length <= 200 && top.body.endsWith("…"));
  assert.equal(postNotification(RAVI, "x", { ...post, parentId: POST }, POST).link, `/community/post/${POST}?comment=${NEW_ID}`);
});
