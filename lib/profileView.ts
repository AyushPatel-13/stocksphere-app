/**
 * What a profile page says, as pure functions so the wording and the share
 * link are unit-tested. Safe to import from the browser.
 */

export type ProfileTabId = "posts" | "replies" | "liked" | "reposts" | "predictions";

export const PROFILE_TAB_LABELS: Record<ProfileTabId, string> = {
  posts: "Posts",
  replies: "Posts & Replies",
  liked: "Liked",
  reposts: "Reposts",
  predictions: "Predictions",
};

/** The public address of a member's profile on this deployment (production, preview or local). */
export function profileUrl(origin: string, username: string): string {
  return `${origin.replace(/\/+$/, "")}/profile/${encodeURIComponent(username)}`;
}

/** "Member since October 2026", from the profile's real creation date; null when there is none. */
export function memberSince(createdAt: string | null | undefined): string | null {
  const time = createdAt ? Date.parse(createdAt) : NaN;
  if (Number.isNaN(time)) return null;
  return `Member since ${new Date(time).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" })}`;
}

/** The empty state of a tab, for the owner or for a visitor. */
export function emptyTabText(tab: ProfileTabId, own: boolean, username: string): string {
  if (own) {
    if (tab === "posts") return "You haven't posted anything yet.";
    if (tab === "replies") return "No posts or replies yet.";
    if (tab === "liked") return "You haven't liked any posts yet.";
    if (tab === "reposts") return "You haven't reposted anything yet.";
    return "You haven't made any predictions yet.";
  }
  if (tab === "posts") return `@${username} hasn't posted any messages.`;
  if (tab === "replies") return `@${username} hasn't posted or replied yet.`;
  if (tab === "liked") return `@${username} hasn't liked any posts yet.`;
  if (tab === "reposts") return `@${username} hasn't reposted anything yet.`;
  return `@${username} hasn't made any predictions yet.`;
}

/** Where a comment shown on a profile lives: its post's page, opened at it. */
export function commentHref(post: { id: string; parentId: string | null; rootId?: string | null }): string {
  const root = post.rootId ?? post.parentId ?? post.id;
  return post.parentId ? `/community/post/${root}?comment=${post.id}` : `/community/post/${post.id}`;
}

export type FollowCounts = { followers: number; following: number };

/** The member's follower count after the viewer follows (or unfollows) them, never below 0. */
export function afterFollow(counts: FollowCounts, follow: boolean): FollowCounts {
  return { ...counts, followers: Math.max(0, counts.followers + (follow ? 1 : -1)) };
}

/** "1 Follower", "12 Followers", "0 Following": a count and its label. */
export function countLabel(count: number, kind: "followers" | "following"): { value: string; label: string } {
  const value = new Intl.NumberFormat("en-IN").format(count);
  if (kind === "following") return { value, label: "Following" };
  return { value, label: count === 1 ? "Follower" : "Followers" };
}

export const DISPLAY_NAME_MAX = 50;
export const BIO_MAX = 160;

/** The checks the profiles table enforces, so the form can say what's wrong before saving. */
export function profileEditProblem(input: { displayName: string; bio: string }): string | null {
  const name = input.displayName.trim();
  if (!name) return "Enter a display name.";
  if (name.length > DISPLAY_NAME_MAX) return `Keep your name under ${DISPLAY_NAME_MAX} characters.`;
  if (input.bio.trim().length > BIO_MAX) return `Keep your bio under ${BIO_MAX} characters.`;
  return null;
}

/** Where "your profile" goes: your public page, onboarding until you pick a handle, your account page otherwise. */
export function myProfileHref(member: { status: string; profile?: { username: string } }): string {
  if (member.status === "ready" && member.profile) return `/profile/${encodeURIComponent(member.profile.username)}`;
  if (member.status === "no-profile") return "/onboarding";
  return "/profile";
}
