import { test } from "node:test";
import assert from "node:assert/strict";

import { GET as listRoute, POST as postRoute } from "@/app/api/community/posts/route";
import {
  commentPath,
  createPost,
  editPost,
  toPostView,
  type CommunityStore,
  type EditablePost,
  type ListQuery,
  type NewPostRow,
  type ParentRecord,
  type ReplyNotification,
} from "../service";
import { MAX_INDENT, buildThread, descendantCount, mergeComments, pathTo, type ThreadNode } from "../thread";
import type { PostView } from "../types";

/*
 * Reddit-style threads. The example from the brief:
 *   POST  "Should I trust this IPO?"
 *     A1  A: "I think so."
 *       B1  B: "Why do you think so?"
 *         A2  A: "Because of the company's fundamentals."
 *     C1  C: "I disagree."               (a separate top-level comment)
 */

const NOW = Date.parse("2026-10-27T08:00:00.000Z");
const OLD_ACCOUNT = "2026-09-01T00:00:00.000Z";
const POST = "10000000-0000-4000-8000-000000000000";
const A1 = "10000000-0000-4000-8000-0000000000a1";
const B1 = "10000000-0000-4000-8000-0000000000b1";
const A2 = "10000000-0000-4000-8000-0000000000a2";
const C1 = "10000000-0000-4000-8000-0000000000c1";
const OTHER_POST = "20000000-0000-4000-8000-000000000000";
const OTHER_COMMENT = "20000000-0000-4000-8000-0000000000a1";
const GONE = "30000000-0000-4000-8000-000000000000";
const NEW_ID = "40000000-0000-4000-8000-000000000000";

const USERS: Record<string, string> = { "token-a": "user-a", "token-b": "user-b", "token-c": "user-c" };

const PARENTS: Record<string, ParentRecord> = {
  [POST]: { symbols: ["TCS"], authorId: "user-p", parentId: null, rootId: null, threads: true },
  [A1]: { symbols: ["TCS"], authorId: "user-a", parentId: POST, rootId: POST, threads: true },
  [B1]: { symbols: ["TCS"], authorId: "user-b", parentId: A1, rootId: POST, threads: true },
  [OTHER_COMMENT]: { symbols: [], authorId: "user-c", parentId: OTHER_POST, rootId: OTHER_POST, threads: true },
};

function author(userId: string) {
  return { username: userId.replace("user-", ""), displayName: userId, avatarUrl: null, role: "user" as const, stats: { resolved: 0, wins: 0, points: 0 } };
}

function comment(id: string, parentId: string | null, minute: number, by = "user-a", extra: Partial<PostView> = {}): PostView {
  return {
    id,
    body: `comment ${id.slice(-2)}`,
    sentiment: null,
    symbols: [],
    parentId,
    rootId: parentId ? POST : null,
    likeCount: 0,
    replyCount: 0,
    createdAt: new Date(NOW + minute * 60_000).toISOString(),
    author: author(by),
    ...extra,
  };
}

function store(overrides: Partial<CommunityStore> = {}, editable: Record<string, EditablePost> = {}) {
  const inserted: NewPostRow[] = [];
  const notified: ReplyNotification[] = [];
  const listed: ListQuery[] = [];
  let currentUser = "";
  const s: CommunityStore = {
    verifyToken: async (token) => {
      currentUser = USERS[token] ?? "";
      return currentUser || null;
    },
    getAuthor: async (id) => ({ id, createdAt: OLD_ACCOUNT }),
    countPostsSince: async () => 0,
    recentBodies: async () => [],
    getParent: async (id) => PARENTS[id] ?? null,
    insertPost: async (row) => {
      inserted.push(row);
      return { ...comment(NEW_ID, row.parent_id, 0, row.author_id), body: row.body, symbols: row.symbols };
    },
    listPosts: async (query) => {
      listed.push(query);
      return [];
    },
    sentiment: async () => ({ bullish: 0, bearish: 0, total: 0 }),
    recentSymbols: async () => [],
    notify: async (row) => {
      notified.push(row);
    },
    getPostForEdit: async (id) => editable[id] ?? null,
    updatePost: async (id, _author, edit) => ({ ...comment(id, POST, 1), body: edit.body, editedAt: edit.edited_at }),
    ...overrides,
  };
  return { s, inserted, notified, listed };
}

const reply = (token: string, body: string, parentId: unknown, postId?: unknown) => ({ token, body, parentId, ...(postId !== undefined ? { postId } : {}) });

/* ------------------------------------------------------------ posting */

test("a top-level comment is stored under the post, with no stance", async () => {
  const { s, inserted } = store();
  const result = await createPost({ ...reply("token-a", "I think so.", POST, POST), sentiment: "bullish" }, s, NOW);
  assert.equal(result.ok, true);
  assert.equal(inserted[0].parent_id, POST);
  assert.equal(inserted[0].sentiment, null);
  assert.deepEqual(inserted[0].symbols, ["TCS"]);
  // The client never sends root_id: the database places the comment in its thread.
  assert.equal("root_id" in inserted[0], false);
});

test("a reply to a comment belongs to that comment, not the post", async () => {
  const { s, inserted } = store();
  const result = await createPost(reply("token-b", "Why do you think so?", A1, POST), s, NOW);
  assert.equal(result.ok, true);
  assert.equal(inserted[0].parent_id, A1);
});

test("a reply to a reply keeps its direct parent", async () => {
  const { s, inserted } = store();
  const result = await createPost(reply("token-a", "Because of the company's fundamentals.", B1, POST), s, NOW);
  assert.equal(result.ok, true);
  assert.equal(inserted[0].parent_id, B1);
});

test("the post id is optional; the parent decides the thread", async () => {
  const { s, inserted } = store();
  assert.equal((await createPost(reply("token-a", "nested without post id", B1), s, NOW)).ok, true);
  assert.equal(inserted[0].parent_id, B1);
});

test("a parent from another post is refused", async () => {
  const { s, inserted } = store();
  const result = await createPost(reply("token-a", "cross-post", OTHER_COMMENT, POST), s, NOW);
  assert.deepEqual([result.ok, (result as { status: number }).status, (result as { code?: string }).code], [false, 400, "WRONG_THREAD"]);
  // …and so is naming another post as the thread of a top-level comment.
  const direct = await createPost(reply("token-a", "cross-post 2", POST, OTHER_POST), s, NOW);
  assert.equal((direct as { code?: string }).code, "WRONG_THREAD");
  assert.equal(inserted.length, 0);
});

test("invalid, missing and deleted parents are refused", async () => {
  const { s, inserted } = store({
    getParent: async (id) => (id === A1 ? { ...PARENTS[A1], deleted: true } : (PARENTS[id] ?? null)),
  });
  assert.equal(((await createPost(reply("token-a", "x", "not-a-uuid"), s, NOW)) as { status: number }).status, 400);
  assert.equal(((await createPost(reply("token-a", "x", 42), s, NOW)) as { status: number }).status, 400);
  assert.equal(((await createPost(reply("token-a", "x", B1, "nope"), s, NOW)) as { status: number }).status, 400);
  assert.equal(((await createPost(reply("token-a", "x", GONE), s, NOW)) as { status: number }).status, 404);
  const deleted = await createPost(reply("token-a", "x", A1), s, NOW);
  assert.deepEqual([(deleted as { status: number }).status, (deleted as { error: string }).error], [404, "That comment was deleted."]);
  assert.equal(inserted.length, 0);
});

test("a corrupt parent with no thread is refused rather than guessed", async () => {
  const { s, inserted } = store({ getParent: async () => ({ symbols: [], parentId: A1, rootId: null, threads: true }) });
  assert.equal(((await createPost(reply("token-a", "x", B1), s, NOW)) as { code?: string }).code, "WRONG_THREAD");
  assert.equal(inserted.length, 0);
});

test("before the migration, replies to replies are refused plainly and direct comments still work", async () => {
  const { s, inserted } = store({ getParent: async (id) => (id === POST ? { symbols: [], parentId: null, threads: false } : { symbols: [], parentId: POST, threads: false }) });
  const nested = await createPost(reply("token-a", "x", A1), s, NOW);
  assert.deepEqual([(nested as { status: number }).status, (nested as { code?: string }).code], [503, "NOT_CONFIGURED"]);
  assert.equal((await createPost(reply("token-a", "top", POST, POST), s, NOW)).ok, true);
  assert.equal(inserted.length, 1);
  // An older store that only knows symbols still accepts direct replies.
  const legacy = store({ getParent: async () => ({ symbols: ["TCS"] }) });
  assert.equal((await createPost(reply("token-a", "legacy", POST), legacy.s, NOW)).ok, true);
});

test("replying needs a signed-in member", async () => {
  const { s, inserted } = store();
  assert.equal(((await createPost({ token: null, body: "x", parentId: A1 }, s, NOW)) as { status: number }).status, 401);
  assert.equal(((await createPost({ token: "bad", body: "x", parentId: A1 }, s, NOW)) as { status: number }).status, 401);
  assert.equal(inserted.length, 0);
});

/* ------------------------------------------------------------ notifications */

test("the parent comment's author is notified, with a link to the reply", async () => {
  const { s, notified } = store();
  await createPost(reply("token-b", "Why do you think so?", A1, POST), s, NOW);
  assert.deepEqual(notified, [
    { user_id: "user-a", title: "@b replied to your comment", body: "Why do you think so?", link: `/community/post/${POST}?comment=${NEW_ID}` },
  ]);
  assert.equal(commentPath(POST, NEW_ID), `/community/post/${POST}?comment=${NEW_ID}`);
  // The link fits the notifications table's local-link rule.
  assert.match(notified[0].link, /^\/[A-Za-z0-9/_.%&=?-]*$/);
});

test("a top-level comment notifies the post's author; replying to yourself notifies nobody", async () => {
  const { s, notified } = store();
  await createPost(reply("token-a", "On the post", POST, POST), s, NOW);
  assert.equal(notified[0].user_id, "user-p");
  assert.equal(notified[0].title, "@a replied to your post");
  await createPost(reply("token-a", "talking to myself", A1, POST), s, NOW);
  assert.equal(notified.length, 1);
});

test("a failed notification never fails the reply", async () => {
  const { s, inserted } = store({
    notify: async () => {
      throw new Error("notifications down");
    },
  });
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal((await createPost(reply("token-b", "still posted", A1, POST), s, NOW)).ok, true);
  } finally {
    console.error = original;
  }
  assert.equal(inserted.length, 1);
});

test("long replies are shortened in the notification", async () => {
  const { s, notified } = store();
  await createPost(reply("token-b", `${"word ".repeat(80)}end`, A1, POST), s, NOW);
  assert.ok(notified[0].body.length <= 200);
  assert.ok(notified[0].body.endsWith("…"));
});

/* ------------------------------------------------------------ edit / delete permissions */

const MINE: EditablePost = { authorId: "user-a", parentId: A1, body: "old", symbols: [], mentions: [], hidden: false };

test("authors edit their own comments and replies; nobody else can", async () => {
  const { s } = store({}, { [A2]: MINE });
  const own = await editPost({ token: "token-a", postId: A2, body: "Because of the fundamentals." }, s, NOW);
  assert.equal(own.ok, true);
  assert.equal((own as { post: PostView }).post.body, "Because of the fundamentals.");
  const other = await editPost({ token: "token-b", postId: A2, body: "hijack" }, s, NOW);
  assert.equal((other as { status: number }).status, 404);
});

test("a deleted comment's placeholder can't be edited back to life", async () => {
  const { s } = store({}, { [A1]: { ...MINE, parentId: POST, deleted: true } });
  assert.equal(((await editPost({ token: "token-a", postId: A1, body: "back" }, s, NOW)) as { status: number }).status, 404);
});

/* ------------------------------------------------------------ rows from the database */

const ROW = {
  id: A1,
  body: "I think so.",
  sentiment: null,
  symbols: ["TCS"],
  parent_id: POST,
  like_count: 3,
  reply_count: 1,
  created_at: new Date(NOW).toISOString(),
  author: { username: "a", display_name: "A", avatar_url: null, role: "user" as const },
};

test("a comment row keeps its parent, thread and likes", () => {
  const view = toPostView({ ...ROW, root_id: POST, comment_count: 0, deleted_at: null });
  assert.deepEqual([view.parentId, view.rootId, view.likeCount, view.replyCount, view.commentCount], [POST, POST, 3, 1, undefined]);
});

test("a deleted comment shows no text, author or tags, but keeps its place and likes", () => {
  const view = toPostView({ ...ROW, root_id: POST, deleted_at: new Date(NOW).toISOString() });
  assert.equal(view.deleted, true);
  assert.equal(view.body, "");
  assert.equal(view.author.username, "deleted");
  assert.deepEqual([view.parentId, view.rootId, view.likeCount, view.symbols], [POST, POST, 3, []]);
});

test("a post counts its whole thread; before the migration, its direct replies", () => {
  const top = { ...ROW, id: POST, parent_id: null, reply_count: 2 };
  assert.equal(toPostView({ ...top, root_id: null, comment_count: 4 }).commentCount, 4);
  assert.equal(toPostView(top).commentCount, 2);
  // Before the migration a reply's thread is its parent.
  assert.equal(toPostView(ROW).rootId, POST);
});

/* ------------------------------------------------------------ the tree */

const FLAT = [comment(A1, POST, 1, "user-a"), comment(B1, A1, 2, "user-b"), comment(A2, B1, 3, "user-a"), comment(C1, POST, 4, "user-c")];

function shape(nodes: ThreadNode[]): unknown[] {
  return nodes.map((n) => [n.id.slice(-2), n.depth, ...(n.children.length ? [shape(n.children)] : [])]);
}

test("the example thread nests every reply under the comment it answers", () => {
  assert.deepEqual(shape(buildThread(FLAT, POST)), [
    ["a1", 0, [["b1", 1, [["a2", 2]]]]],
    ["c1", 0],
  ]);
});

test("after a refresh, in any order, replies are still under the right parent", () => {
  const shuffled = [FLAT[2], FLAT[3], FLAT[0], FLAT[1]];
  assert.deepEqual(shape(buildThread(shuffled, POST)), shape(buildThread(FLAT, POST)));
});

test("an optimistic reply followed by a reload is shown once", () => {
  const optimistic = comment(A2, B1, 3, "user-a", { body: "first copy" });
  const merged = mergeComments([optimistic], FLAT);
  assert.equal(merged.length, 4);
  const tree = buildThread([...FLAT, optimistic], POST);
  assert.equal(tree[0].children[0].children.length, 1);
  assert.equal(tree[0].children[0].children[0].post?.body, "first copy");
});

test("a reply whose parent is hidden keeps its context under a placeholder", () => {
  const tree = buildThread([FLAT[1], FLAT[2], FLAT[3]], POST);
  assert.deepEqual(shape(tree), [
    ["a1", 0, [["b1", 1, [["a2", 2]]]]],
    ["c1", 0],
  ]);
  assert.equal(tree[0].post, null);
  assert.equal(descendantCount(tree[0]), 2);
});

test("an empty thread is empty; a deleted comment keeps its replies", () => {
  assert.deepEqual(buildThread([], POST), []);
  const tree = buildThread([{ ...FLAT[0], deleted: true, body: "" }, ...FLAT.slice(1)], POST);
  assert.equal(tree[0].post?.deleted, true);
  assert.equal(tree[0].children[0].id, B1);
});

test("looping links are cut instead of dropping comments", () => {
  const loop = [comment(A1, B1, 1), comment(B1, A1, 2), comment(C1, POST, 3)];
  const tree = buildThread(loop, POST);
  const ids = new Set<string>();
  const visit = (nodes: ThreadNode[]) => nodes.forEach((n) => (ids.add(n.id), visit(n.children)));
  visit(tree);
  assert.deepEqual([...ids].sort(), [A1, B1, C1].sort());
});

test("comments from another thread and the post itself are left out", () => {
  const stray = comment(OTHER_COMMENT, OTHER_POST, 1, "user-c", { rootId: OTHER_POST });
  const self = { ...comment(POST, null, 0), rootId: null };
  assert.deepEqual(shape(buildThread([...FLAT, stray, self], POST)).length, 2);
});

test("deep threads keep every level and their real parents", () => {
  const chain: PostView[] = [];
  let parent = POST;
  for (let i = 0; i < 12; i++) {
    const id = `50000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`;
    chain.push(comment(id, parent, i));
    parent = id;
  }
  const tree = buildThread(chain, POST);
  let node = tree[0];
  for (let depth = 0; depth < 11; depth++) {
    assert.equal(node.depth, depth);
    assert.equal(node.children[0].post?.parentId, node.id);
    node = node.children[0];
  }
  assert.equal(pathTo(tree, chain[11].id).length, 12);
  assert.ok(MAX_INDENT < 12);
  assert.deepEqual(pathTo(tree, GONE), []);
});

/* ------------------------------------------------------------ the API */

test("GET ?thread= loads a whole thread in one query and validates ids", async () => {
  const { s, listed } = store({ listPosts: async (query) => (listed.push(query), FLAT) });
  const response = await listRoute(new Request(`http://x/api/community/posts?thread=${POST}&after=2026-10-27T08:01:00.000Z`), undefined, s, null, null, null);
  const json = await response.json();
  assert.equal(json.posts.length, 4);
  assert.equal(json.hasMore, false);
  assert.deepEqual(listed, [{ thread: POST, after: "2026-10-27T08:01:00.000Z", limit: 200 }]);

  const bad = await listRoute(new Request("http://x/api/community/posts?thread=nope"), undefined, s, null, null, null);
  assert.equal(bad.status, 400);
});

test("GET ?id= returns one post or a 404", async () => {
  const { s } = store({ listPosts: async (query) => (query.id === A1 ? [FLAT[0]] : []) });
  const found = await (await listRoute(new Request(`http://x/api/community/posts?id=${A1}`), undefined, s, null, null, null)).json();
  assert.equal(found.post.id, A1);
  const missing = await listRoute(new Request(`http://x/api/community/posts?id=${GONE}`), undefined, s, null, null, null);
  assert.equal(missing.status, 404);
});

test("POST passes the thread's post id through to the check", async () => {
  const { s, inserted } = store();
  const request = (postId: string) =>
    new Request("http://x/api/community/posts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer token-b" },
      body: JSON.stringify({ body: "Why do you think so?", parentId: A1, postId }),
    });
  assert.equal((await postRoute(request(POST), undefined, s, null, null, null)).status, 201);
  assert.equal((await postRoute(request(OTHER_POST), undefined, s, null, null, null)).status, 400);
  assert.equal(inserted.length, 1);
});
