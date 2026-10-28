import { test } from "node:test";
import assert from "node:assert/strict";

import { GET as listRoute } from "@/app/api/community/posts/route";
import { BIO_MAX, DISPLAY_NAME_MAX, afterFollow, commentHref, countLabel, myProfileHref, emptyTabText, memberSince, profileEditProblem, profileUrl } from "../../profileView";
import { getProfileFeed, type CommunityStore, type ListQuery } from "../service";
import type { PostView } from "../types";

/** The profile page: its tabs' data, and what it says. */

const AYUSH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";

function post(id: string, createdAt: string, parentId: string | null = null): PostView {
  return {
    id,
    body: `post ${id}`,
    sentiment: null,
    symbols: [],
    parentId,
    rootId: parentId,
    likeCount: 0,
    replyCount: 0,
    createdAt,
    author: { username: "ayush", displayName: "Ayush", avatarUrl: null, role: "user", stats: { resolved: 0, wins: 0, points: 0 } },
  };
}

function store(overrides: Partial<CommunityStore> = {}): CommunityStore & { lists: ListQuery[] } {
  const lists: ListQuery[] = [];
  return {
    lists,
    verifyToken: async () => null,
    getAuthor: async () => null,
    countPostsSince: async () => 0,
    recentBodies: async () => [],
    getParent: async () => null,
    insertPost: async () => {
      throw new Error("no writes here");
    },
    listPosts: async (query) => {
      lists.push(query);
      if (query.ids) return [post(P2, "2026-10-26T00:00:00Z"), post(P1, "2026-10-25T00:00:00Z")].filter((p) => query.ids!.includes(p.id));
      return query.withReplies ? [post(P3, "2026-10-27T00:00:00Z", P1), post(P1, "2026-10-25T00:00:00Z")] : [post(P1, "2026-10-25T00:00:00Z")];
    },
    sentiment: async () => ({ bullish: 0, bearish: 0, total: 0 }),
    recentSymbols: async () => [],
    profileId: async (username) => (username === "ayush" ? AYUSH : null),
    likes: async () => [
      { postId: P1, likedAt: "2026-10-28T09:00:00Z" },
      { postId: P3, likedAt: "2026-10-28T08:00:00Z" }, // since hidden: RLS doesn't return it
      { postId: P2, likedAt: "2026-10-27T09:00:00Z" },
    ],
    ...overrides,
  };
}

test("Posts lists a member's top-level posts; Posts & Replies adds their comments", async () => {
  const s = store();
  const posts = await getProfileFeed(s, { username: "ayush", tab: "posts", limit: 20 });
  assert.deepEqual(posts.ok && posts.posts.map((p) => p.id), [P1]);
  assert.deepEqual([s.lists[0].author, s.lists[0].withReplies], [AYUSH, false]);

  const replies = await getProfileFeed(s, { username: "ayush", tab: "replies", before: "2026-10-28T00:00:00Z", limit: 20 });
  assert.deepEqual(replies.ok && replies.posts.map((p) => p.id), [P3, P1]);
  assert.deepEqual([s.lists[1].withReplies, s.lists[1].before], [true, "2026-10-28T00:00:00Z"]);
  assert.equal(replies.ok && replies.next, "2026-10-25T00:00:00Z");
});

test("Liked lists posts in the order they were liked, skipping ones no longer visible, and pages by the like", async () => {
  const s = store();
  const liked = await getProfileFeed(s, { username: "ayush", tab: "liked", limit: 3 });
  assert.equal(liked.ok, true);
  assert.deepEqual(liked.ok && liked.posts.map((p) => p.id), [P1, P2]);
  // A full page of likes means there may be more, even though one post dropped out.
  assert.deepEqual(liked.ok && [liked.hasMore, liked.next], [true, "2026-10-27T09:00:00Z"]);

  const none = await getProfileFeed(store({ likes: async () => [] }), { username: "ayush", tab: "liked", limit: 20 });
  assert.deepEqual(none.ok && [none.posts, none.hasMore, none.next], [[], false, null]);
});

test("an unknown handle is a 404, and a store without profile support says so", async () => {
  const missing = await getProfileFeed(store(), { username: "nobody", tab: "posts", limit: 20 });
  assert.equal(!missing.ok && missing.status, 404);
  const off = await getProfileFeed(store({ profileId: undefined }), { username: "ayush", tab: "posts", limit: 20 });
  assert.equal(!off.ok && off.status, 503);
  assert.equal(!(await getProfileFeed(null, { username: "ayush", tab: "posts", limit: 20 })).ok, true);
});

test("the route validates the handle and tab and returns the next cursor", async () => {
  const s = store();
  const ok = await listRoute(new Request("http://x/api/community/posts?profile=Ayush&tab=liked&limit=3"), undefined, s, null, null, null);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.deepEqual([body.posts.length, body.next], [2, "2026-10-27T09:00:00Z"]);

  for (const query of ["profile=ayush&tab=followers", "profile=../etc&tab=posts", "profile=a&tab=posts"]) {
    const bad = await listRoute(new Request(`http://x/api/community/posts?${query}`), undefined, s, null, null, null);
    assert.equal(bad.status, 400, query);
  }
  const unknown = await listRoute(new Request("http://x/api/community/posts?profile=nobody"), undefined, s, null, null, null);
  assert.equal(unknown.status, 404);

  const broken = await listRoute(new Request("http://x/api/community/posts?profile=ayush"), undefined, store({ profileId: async () => Promise.reject(new Error("down")) }), null, null, null);
  assert.equal(broken.status, 503);
});

test("profile wording: share link, member-since date and empty states", () => {
  assert.equal(profileUrl("https://stocksphere-theta.vercel.app/", "ayush"), "https://stocksphere-theta.vercel.app/profile/ayush");
  assert.equal(memberSince("2026-10-01T00:00:00Z"), "Member since October 2026");
  assert.equal(memberSince(null), null);
  assert.equal(memberSince("not a date"), null);

  assert.equal(emptyTabText("posts", true, "ayush"), "You haven't posted anything yet.");
  assert.equal(emptyTabText("replies", true, "ayush"), "No posts or replies yet.");
  assert.equal(emptyTabText("liked", true, "ayush"), "You haven't liked any posts yet.");
  assert.equal(emptyTabText("posts", false, "ravi"), "@ravi hasn't posted any messages.");

  assert.equal(commentHref({ id: P3, parentId: P2, rootId: P1 }), `/community/post/${P1}?comment=${P3}`);
  assert.equal(commentHref({ id: P1, parentId: null }), `/community/post/${P1}`);
});

test("profile edits follow the table's limits", () => {
  assert.equal(profileEditProblem({ displayName: "Ayush", bio: "" }), null);
  assert.notEqual(profileEditProblem({ displayName: "   ", bio: "" }), null);
  assert.notEqual(profileEditProblem({ displayName: "a".repeat(DISPLAY_NAME_MAX + 1), bio: "" }), null);
  assert.notEqual(profileEditProblem({ displayName: "Ayush", bio: "b".repeat(BIO_MAX + 1) }), null);
  assert.equal(profileEditProblem({ displayName: "Ayush", bio: "b".repeat(BIO_MAX) }), null);
});

test("follow counts move by one, never below zero, and read naturally", () => {
  assert.deepEqual(afterFollow({ followers: 4, following: 2 }, true), { followers: 5, following: 2 });
  assert.deepEqual(afterFollow({ followers: 0, following: 2 }, false), { followers: 0, following: 2 });
  assert.deepEqual(countLabel(1, "followers"), { value: "1", label: "Follower" });
  assert.deepEqual(countLabel(0, "followers"), { value: "0", label: "Followers" });
  assert.deepEqual(countLabel(125000, "following"), { value: "1,25,000", label: "Following" });
});

test("your avatar and name open your own public profile", () => {
  assert.equal(myProfileHref({ status: "ready", profile: { username: "ayush" } }), "/profile/ayush");
  // No handle yet: pick one first.
  assert.equal(myProfileHref({ status: "no-profile" }), "/onboarding");
  // Still loading, or profiles unavailable: the account page, which needs no handle.
  assert.equal(myProfileHref({ status: "loading" }), "/profile");
  assert.equal(myProfileHref({ status: "unavailable" }), "/profile");
});
