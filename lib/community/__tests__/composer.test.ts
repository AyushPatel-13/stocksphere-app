import { test } from "node:test";
import assert from "node:assert/strict";

import { GET as listRoute, PATCH as patchRoute, POST as postRoute } from "@/app/api/community/posts/route";
import { pickSpans, type MentionPick } from "../mentionInput";
import { POST_MAX_LENGTH, TITLE_MAX_LENGTH, checkTitle, isPostKind } from "../rules";
import { createPost, editPost, readPostMeta, toPostView, type CommunityStore, type EditablePost, type ListQuery, type NewPostRow, type PostEdit } from "../service";
import { linkPreviews, normaliseLinkInput } from "../tokens";
import type { PostView } from "../types";

/** The full composer: titles, post types, links, preview spans, and the server rules behind them. */

const NOW = Date.parse("2026-10-28T08:00:00.000Z");
const OLD_ACCOUNT = "2026-09-01T00:00:00.000Z";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const COMMENT_ID = "44444444-4444-4444-8444-444444444444";

function view(row: NewPostRow): PostView {
  return {
    id: POST_ID,
    title: row.title ?? null,
    kind: row.kind ?? null,
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

const missingColumn = () => Object.assign(new Error('column "title" does not exist'), { code: "42703" });

function store(
  overrides: Partial<CommunityStore> = {},
  editable: Record<string, EditablePost> = {}
): CommunityStore & { inserted: NewPostRow[]; edits: PostEdit[]; lists: ListQuery[] } {
  const inserted: NewPostRow[] = [];
  const edits: PostEdit[] = [];
  const lists: ListQuery[] = [];
  return {
    inserted,
    edits,
    lists,
    verifyToken: async (token) => (token === "good" ? "user-1" : token === "other" ? "user-2" : null),
    getAuthor: async (id) => ({ id, createdAt: OLD_ACCOUNT }),
    countPostsSince: async () => 0,
    recentBodies: async () => [],
    getParent: async (id) => (id === POST_ID ? { symbols: [], authorId: "user-2", parentId: null, rootId: null, threads: true } : null),
    insertPost: async (row) => {
      inserted.push(row);
      return view(row);
    },
    listPosts: async (query) => {
      lists.push(query);
      return [];
    },
    sentiment: async () => ({ bullish: 0, bearish: 0, total: 0 }),
    recentSymbols: async () => [],
    getPostForEdit: async (id) => editable[id] ?? null,
    updatePost: async (id, _author, edit) => {
      edits.push(edit);
      return { ...view({ author_id: "user-1", body: edit.body, sentiment: null, symbols: edit.symbols, parent_id: null }), id, title: edit.title ?? null, kind: edit.kind ?? null };
    },
    ...overrides,
  };
}

const mine = (overrides: Partial<EditablePost> = {}): EditablePost => ({
  authorId: "user-1",
  parentId: null,
  body: "Margins look stretched.",
  symbols: [],
  mentions: [],
  hidden: false,
  ...overrides,
});

/* ------------------------------------------------ titles */

test("a title is optional, one line, trimmed, and at most 120 characters", () => {
  assert.deepEqual(checkTitle(undefined), { ok: true, title: null });
  assert.deepEqual(checkTitle(null), { ok: true, title: null });
  assert.deepEqual(checkTitle("   "), { ok: true, title: null });
  assert.deepEqual(checkTitle("  Is   TCS\novervalued?  "), { ok: true, title: "Is TCS overvalued?" });
  assert.deepEqual(checkTitle("a".repeat(TITLE_MAX_LENGTH)), { ok: true, title: "a".repeat(TITLE_MAX_LENGTH) });
  assert.equal(checkTitle("a".repeat(TITLE_MAX_LENGTH + 1)).ok, false);
  assert.equal(checkTitle(42).ok, false);
});

test("a title follows the same spam rules as a post, and can't carry links", () => {
  for (const bad of ["Read https://example.com", "see www.example.com", "Join my telegram channel for tips", "Sure-shot jackpot call", "Call 98765 43210", "THIS STOCK IS GOING TO THE MOON NOW"]) {
    assert.equal(checkTitle(bad).ok, false, bad);
  }
  assert.equal(checkTitle("Q2 results: what changed for HDFC Bank?").ok, true);
});

test("post types are a fixed list", () => {
  for (const kind of ["analysis", "technical", "earnings", "news", "question", "discussion"]) assert.equal(isPostKind(kind), true);
  for (const kind of ["tip", "educational", "Question", "", null, 3]) assert.equal(isPostKind(kind), false);
  assert.deepEqual(readPostMeta(undefined, ""), { ok: true, title: null, kind: null });
  assert.equal(readPostMeta(undefined, "signal").ok, false);
});

/* ------------------------------------------------ creating */

test("a post is stored with its title and type", async () => {
  const s = store();
  const result = await createPost({ token: "good", body: "Margins look stretched at 30x.", title: " Is TCS overvalued? ", kind: "question", sentiment: "bearish" }, s, NOW);
  assert.equal(result.ok, true);
  assert.deepEqual([s.inserted[0].title, s.inserted[0].kind, s.inserted[0].sentiment], ["Is TCS overvalued?", "question", "bearish"]);
  assert.equal(result.ok && result.post.title, "Is TCS overvalued?");
});

test("a post without a title or type writes neither column (it works before the migration)", async () => {
  const s = store();
  const result = await createPost({ token: "good", body: "Plain post", title: "", kind: null }, s, NOW);
  assert.equal(result.ok, true);
  assert.equal("title" in s.inserted[0], false);
  assert.equal("kind" in s.inserted[0], false);
});

test("empty, oversized and invalid posts are refused before anything is stored", async () => {
  const s = store();
  const cases: [{ body: unknown } & Record<string, unknown>, number][] = [
    [{ body: "   " }, 422],
    [{ body: "x".repeat(POST_MAX_LENGTH + 1) }, 422],
    [{ body: 12 }, 400],
    [{ body: "ok", title: "t".repeat(TITLE_MAX_LENGTH + 1) }, 422],
    [{ body: "ok", kind: "pump" }, 400],
  ];
  for (const [input, status] of cases) {
    const result = await createPost({ token: "good", ...input }, s, NOW);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(!result.ok && result.status, status, JSON.stringify(input));
  }
  assert.equal(s.inserted.length, 0);
});

test("comments don't take a title or type", async () => {
  const s = store();
  for (const extra of [{ title: "A titled reply" }, { kind: "analysis" }]) {
    const result = await createPost({ token: "good", body: "I disagree.", parentId: POST_ID, postId: POST_ID, ...extra }, s, NOW);
    assert.equal(!result.ok && result.status, 400);
  }
  assert.equal(s.inserted.length, 0);
  assert.equal((await createPost({ token: "good", body: "I disagree.", parentId: POST_ID, postId: POST_ID }, s, NOW)).ok, true);
});

test("a second identical submit is refused as a duplicate", async () => {
  const bodies: string[] = [];
  const s = store({
    recentBodies: async () => bodies,
    insertPost: async (row) => {
      bodies.push(row.body);
      return view(row);
    },
  });
  assert.equal((await createPost({ token: "good", body: "Results next week." }, s, NOW)).ok, true);
  const again = await createPost({ token: "good", body: "Results next week." }, s, NOW);
  assert.equal(!again.ok && again.code, "DUPLICATE");
  assert.equal(bodies.length, 1);
});

test("before the migration, a titled post gets a clear 503 instead of losing its title", async () => {
  const s = store({ insertPost: async () => Promise.reject(missingColumn()) });
  const result = await createPost({ token: "good", body: "x y z", title: "A title" }, s, NOW);
  assert.deepEqual(!result.ok && [result.status, result.code], [503, "NOT_CONFIGURED"]);

  // Any other failure is still an error, not a silent success.
  const broken = store({ insertPost: async () => Promise.reject(new Error("boom")) });
  await assert.rejects(createPost({ token: "good", body: "x y z", title: "A title" }, broken, NOW), /boom/);
});

/* ------------------------------------------------ editing */

test("an author can change or remove a title and type; leaving them out keeps them", async () => {
  const s = store({}, { [POST_ID]: mine() });

  assert.equal((await editPost({ token: "good", postId: POST_ID, body: "Edited text", title: "New title", kind: "analysis" }, s, NOW)).ok, true);
  assert.deepEqual([s.edits[0].title, s.edits[0].kind], ["New title", "analysis"]);

  assert.equal((await editPost({ token: "good", postId: POST_ID, body: "Edited again", title: "", kind: null }, s, NOW)).ok, true);
  assert.deepEqual([s.edits[1].title, s.edits[1].kind], [null, null]);

  assert.equal((await editPost({ token: "good", postId: POST_ID, body: "Text only" }, s, NOW)).ok, true);
  assert.equal("title" in s.edits[2] || "kind" in s.edits[2], false);
});

test("nobody can edit someone else's post, and comments can't gain a title", async () => {
  const s = store({}, { [POST_ID]: mine(), [COMMENT_ID]: mine({ parentId: POST_ID }) });
  const other = await editPost({ token: "other", postId: POST_ID, body: "Hijack", title: "Hijacked" }, s, NOW);
  assert.equal(!other.ok && other.status, 404);
  const signedOut = await editPost({ token: null, postId: POST_ID, body: "x" }, s, NOW);
  assert.equal(!signedOut.ok && signedOut.status, 401);
  const comment = await editPost({ token: "good", postId: COMMENT_ID, body: "x", title: "No" }, s, NOW);
  assert.equal(!comment.ok && comment.status, 400);
  const badTitle = await editPost({ token: "good", postId: POST_ID, body: "x", title: "t".repeat(TITLE_MAX_LENGTH + 1) }, s, NOW);
  assert.equal(!badTitle.ok && badTitle.status, 422);
  assert.equal(s.edits.length, 0);
});

test("before the migration, editing a title is a clear 503 but text-only edits still save", async () => {
  const s = store(
    {
      updatePost: async (_id, _a, edit) => {
        if ("title" in edit || "kind" in edit) throw missingColumn();
        return view({ author_id: "user-1", body: edit.body, sentiment: null, symbols: [], parent_id: null });
      },
    },
    { [POST_ID]: mine() }
  );
  const titled = await editPost({ token: "good", postId: POST_ID, body: "x", title: "T" }, s, NOW);
  assert.deepEqual(!titled.ok && [titled.status, titled.code], [503, "NOT_CONFIGURED"]);
  assert.equal((await editPost({ token: "good", postId: POST_ID, body: "x" }, s, NOW)).ok, true);
});

/* ------------------------------------------------ reading */

const AUTHOR = { username: "a", display_name: "A", avatar_url: null, role: "user" as const };

test("posts read their title and type; comments and old rows have none", () => {
  const base = { id: POST_ID, body: "b", sentiment: null, symbols: [], like_count: 0, reply_count: 0, created_at: new Date(NOW).toISOString(), author: AUTHOR };
  const post = toPostView({ ...base, parent_id: null, title: "Headline", kind: "news" });
  assert.deepEqual([post.title, post.kind], ["Headline", "news"]);

  const unknownKind = toPostView({ ...base, parent_id: null, title: null, kind: "spam" });
  assert.deepEqual([unknownKind.title, unknownKind.kind], [null, null]);

  const old = toPostView({ ...base, parent_id: null });
  assert.equal("title" in old, false);

  const comment = toPostView({ ...base, parent_id: POST_ID, root_id: POST_ID, title: null, kind: null });
  assert.equal("title" in comment, false);
});

test("the feed filters by post type, and refuses an unknown one", async () => {
  const s = store();
  const ok = await listRoute(new Request("http://x/api/community/posts?kind=question"), undefined, s, null, null, null);
  assert.equal(ok.status, 200);
  assert.equal(s.lists[0].kind, "question");

  const all = await listRoute(new Request("http://x/api/community/posts?kind=all&sentiment=bullish"), undefined, s, null, null, null);
  assert.equal(all.status, 200);
  assert.deepEqual([s.lists[1].kind, s.lists[1].sentiment], [undefined, "bullish"]);

  const bad = await listRoute(new Request("http://x/api/community/posts?kind=pump"), undefined, s, null, null, null);
  assert.equal(bad.status, 400);
});

test("routes pass the title and type through POST and PATCH", async () => {
  const s = store({}, { [POST_ID]: mine() });
  const created = await postRoute(
    new Request("http://x/api/community/posts", {
      method: "POST",
      headers: { Authorization: "Bearer good", "Content-Type": "application/json" },
      body: JSON.stringify({ body: "What do you make of this?", title: "Q2 thoughts", kind: "discussion" }),
    }),
    undefined,
    s,
    null,
    null,
    null
  );
  assert.equal(created.status, 201);
  assert.deepEqual([s.inserted[0].title, s.inserted[0].kind], ["Q2 thoughts", "discussion"]);

  const edited = await patchRoute(
    new Request("http://x/api/community/posts", {
      method: "PATCH",
      headers: { Authorization: "Bearer good", "Content-Type": "application/json" },
      body: JSON.stringify({ id: POST_ID, body: "Edited", kind: "analysis" }),
    }),
    undefined,
    s,
    null,
    null
  );
  assert.equal(edited.status, 200);
  assert.deepEqual([s.edits[0].kind, "title" in s.edits[0]], ["analysis", false]);
});

/* ------------------------------------------------ links */

test("link cards show the real host and path, at most two, never non-http links", () => {
  const previews = linkPreviews(
    "See https://www.nseindia.com/companies-listing?symbol=TCS and https://www.nseindia.com/companies-listing?symbol=TCS, then http://example.org/ and https://third.example/x"
  );
  assert.deepEqual(previews, [
    { href: "https://www.nseindia.com/companies-listing?symbol=TCS", host: "nseindia.com", path: "/companies-listing?symbol=TCS" },
    { href: "http://example.org/", host: "example.org", path: "" },
  ]);
  assert.deepEqual(linkPreviews("javascript:alert(1) and data:text/html,hi"), []);
  // A look-alike domain shows as punycode, not as the name it imitates.
  assert.equal(linkPreviews("https://аpple.com/login")[0].host.startsWith("xn--"), true);
});

test("the Add link box accepts http(s) links only", () => {
  assert.deepEqual(normaliseLinkInput(" nseindia.com/get-quotes "), { ok: true, href: "https://nseindia.com/get-quotes" });
  assert.deepEqual(normaliseLinkInput("http://example.org"), { ok: true, href: "http://example.org/" });
  for (const bad of ["", "javascript:alert(1)", "ftp://x.org/f", "not a link", "localhost", "https://user:pw@example.org"]) {
    assert.equal(normaliseLinkInput(bad).ok, false, bad);
  }
});

/* ------------------------------------------------ preview */

test("the preview highlights exactly the tags still in the text", () => {
  const picks: MentionPick[] = [
    { kind: "instrument", id: "India:SBIN", type: "stock", text: "@SBIN", name: "State Bank of India", detail: "SBIN · NSE" },
    { kind: "bond", isin: "IN0020230085", text: "@718GS2033", name: "GOI 2033", detail: "Govt" },
    { kind: "ipo", ipoId: "tonbo", text: "@Tonbo IPO", name: "Tonbo", detail: "IPO" },
  ];
  const body = "Compare @718GS2033 with @SBIN";
  assert.deepEqual(
    pickSpans(body, picks).map(({ pick, start, end }) => [pick.kind, body.slice(start, end)]),
    [
      ["bond", "@718GS2033"],
      ["instrument", "@SBIN"],
    ]
  );
});
