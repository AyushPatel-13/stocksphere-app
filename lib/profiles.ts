import { supabase } from "./supabase";
import { handleProblem, normaliseHandle } from "./validation/handle";

/**
 * Community profiles (public.profiles).
 *
 * The table's RLS lets anyone read profiles and lets a user write only their
 * own row, never their role. These helpers never pass `role` or `id` on
 * update, and on insert `id` comes from the session, so a caller cannot ask
 * for anything the policies would refuse anyway.
 */

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  role: "user" | "moderator" | "admin";
  created_at: string;
};

const COLUMNS = "id, username, display_name, avatar_url, bio, role, created_at";

/**
 * The outcome of looking up the signed-in user's profile.
 *
 * "unavailable" covers every failure, including the profiles table not
 * existing yet (migration not applied). Callers must treat it as "don't
 * know", never as "has no profile" — otherwise an outage would push every
 * user into onboarding.
 */
export type MyProfileResult =
  | { status: "signed-out" }
  | { status: "missing" }
  | { status: "ok"; profile: Profile }
  | { status: "unavailable" };

export async function getMyProfile(): Promise<MyProfileResult> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { status: "signed-out" };

    const { data, error } = await supabase
      .from("profiles")
      .select(COLUMNS)
      .eq("id", user.id)
      .maybeSingle();

    if (error) return { status: "unavailable" };
    if (!data) return { status: "missing" };

    return { status: "ok", profile: data as Profile };
  } catch {
    return { status: "unavailable" };
  }
}

/** A public profile by @handle, or null when there is none / it can't be read. */
export async function getProfileByHandle(handle: string): Promise<Profile | null> {
  const username = normaliseHandle(handle);
  if (handleProblem(username) !== null) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select(COLUMNS)
    .eq("username", username)
    .maybeSingle();

  return error ? null : ((data as Profile | null) ?? null);
}

/** true / false when known; null when the check itself failed. */
export async function isHandleAvailable(handle: string): Promise<boolean | null> {
  const username = normaliseHandle(handle);

  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("username", username);

  return error ? null : count === 0;
}

export type CreateProfileResult =
  | { ok: true; profile: Profile }
  | { ok: false; reason: "taken" | "invalid" | "signed-out" | "failed"; message: string };

export async function createMyProfile(input: {
  handle: string;
  displayName: string;
  avatarUrl?: string | null;
}): Promise<CreateProfileResult> {
  const username = normaliseHandle(input.handle);
  const problem = handleProblem(username);
  if (problem) return { ok: false, reason: "invalid", message: problem };

  const displayName = input.displayName.trim().slice(0, 50);
  if (!displayName) {
    return { ok: false, reason: "invalid", message: "Enter a display name." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, reason: "signed-out", message: "Please sign in again." };
  }

  const avatar =
    input.avatarUrl && input.avatarUrl.startsWith("https://") ? input.avatarUrl : null;

  const { data, error } = await supabase
    .from("profiles")
    .insert({ id: user.id, username, display_name: displayName, avatar_url: avatar })
    .select(COLUMNS)
    .single();

  if (error) {
    // 23505 = unique_violation: someone else has the handle (or this user
    // already has a profile, which the caller treats the same way: reload).
    if (error.code === "23505") {
      return { ok: false, reason: "taken", message: "That handle was just taken. Try another." };
    }
    if (error.code === "23514") {
      return { ok: false, reason: "invalid", message: "That handle isn't allowed." };
    }
    return { ok: false, reason: "failed", message: "Couldn't save your profile. Please try again." };
  }

  return { ok: true, profile: data as Profile };
}
