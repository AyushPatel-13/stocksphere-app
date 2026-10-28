import { supabase } from "./supabase";

/**
 * Follows (public.follows, follows migration), straight through Supabase:
 * RLS lets anyone read them and a member insert or delete only their own
 * (follower_id = the session's user), so these helpers can't do more than
 * that. The counts on profiles are kept by a database trigger.
 */

export type FollowPerson = { username: string; displayName: string; avatarUrl: string | null };

/** Whether `viewerId` follows `memberId`; null when it couldn't be checked. */
export async function isFollowing(viewerId: string, memberId: string): Promise<boolean | null> {
  const { count, error } = await supabase
    .from("follows")
    .select("follower_id", { count: "exact", head: true })
    .eq("follower_id", viewerId)
    .eq("followee_id", memberId);
  return error ? null : (count ?? 0) > 0;
}

/** Follow or unfollow `memberId` as the signed-in member. Following twice is fine (it already holds). */
export async function setFollowing(memberId: string, follow: boolean): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id === memberId) return false;

  if (follow) {
    const { error } = await supabase.from("follows").insert({ follower_id: user.id, followee_id: memberId });
    return !error || error.code === "23505";
  }
  const { error } = await supabase.from("follows").delete().eq("follower_id", user.id).eq("followee_id", memberId);
  return !error;
}

const PERSON = "username, display_name, avatar_url";

/** Who follows a member ("followers"), or whom they follow ("following"), newest first. */
export async function listFollows(memberId: string, direction: "followers" | "following", limit = 50): Promise<FollowPerson[] | null> {
  const query =
    direction === "followers"
      ? supabase.from("follows").select(`person:profiles!follows_follower_id_fkey(${PERSON})`).eq("followee_id", memberId)
      : supabase.from("follows").select(`person:profiles!follows_followee_id_fkey(${PERSON})`).eq("follower_id", memberId);

  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
  if (error) return null;

  type Row = { username: string; display_name: string; avatar_url: string | null };
  return (data ?? []).flatMap((row) => {
    const joined = (row as { person: Row | Row[] | null }).person;
    const person = Array.isArray(joined) ? joined[0] : joined;
    return person ? [{ username: person.username, displayName: person.display_name, avatarUrl: person.avatar_url }] : [];
  });
}
