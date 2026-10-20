import { supabase } from "./supabase";
import { MAX_NAME_LENGTH, cleanListName, isMissingTable } from "./watchlistRules";

export { MAX_LISTS, MAX_NAME_LENGTH, cleanListName, isMissingTable } from "./watchlistRules";

/**
 * Named watchlists (migration 20261020000100_watchlists.sql).
 *
 * Until that migration is applied the `watchlists` table doesn't exist, and
 * every function here reports "single" mode: the page then shows the one
 * list stored in `watchlist`, exactly as before. Nothing is created or
 * migrated from the browser.
 */

export type NamedWatchlist = { id: string; name: string; position: number };

export type WatchlistMode =
  | { mode: "single" }
  | { mode: "multi"; lists: NamedWatchlist[] };

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * The member's lists, oldest first. A member with no list yet gets their first
 * one ("My Watchlist") created here, so the multi-list page always has a tab.
 */
export async function loadWatchlistMode(): Promise<WatchlistMode> {
  const userId = await currentUserId();
  if (!userId) return { mode: "single" };

  const { data, error } = await supabase
    .from("watchlists")
    .select("id, name, position")
    .eq("user_id", userId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (isMissingTable(error)) return { mode: "single" };
  if (error) throw error;

  if ((data ?? []).length > 0) return { mode: "multi", lists: data as NamedWatchlist[] };

  const created = await supabase
    .from("watchlists")
    .insert({ user_id: userId, name: "My Watchlist", position: 0 })
    .select("id, name, position")
    .single();
  if (created.error) throw created.error;
  return { mode: "multi", lists: [created.data as NamedWatchlist] };
}

export async function createList(name: string, position: number): Promise<NamedWatchlist> {
  const clean = cleanListName(name);
  if (!clean) throw new Error(`List names are 1–${MAX_NAME_LENGTH} characters.`);
  const userId = await currentUserId();
  if (!userId) throw new Error("Sign in to create lists.");

  const { data, error } = await supabase
    .from("watchlists")
    .insert({ user_id: userId, name: clean, position })
    .select("id, name, position")
    .single();
  if (error?.code === "23505") throw new Error(`You already have a list called “${clean}”.`);
  if (error) throw error;
  return data as NamedWatchlist;
}

export async function renameList(id: string, name: string): Promise<void> {
  const clean = cleanListName(name);
  if (!clean) throw new Error(`List names are 1–${MAX_NAME_LENGTH} characters.`);
  const { error } = await supabase.from("watchlists").update({ name: clean }).eq("id", id);
  if (error?.code === "23505") throw new Error(`You already have a list called “${clean}”.`);
  if (error) throw error;
}

/** Deletes the list and its symbols (ON DELETE CASCADE). */
export async function deleteList(id: string): Promise<void> {
  const { error } = await supabase.from("watchlists").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Symbols in one list. The first list also shows rows with no list
 * (added by an older client), so nothing is ever hidden.
 */
export async function getListSymbols(list: NamedWatchlist, isFirst: boolean): Promise<string[]> {
  const userId = await currentUserId();
  if (!userId) return [];

  let query = supabase.from("watchlist").select("symbol").eq("user_id", userId);
  query = isFirst ? query.or(`watchlist_id.eq.${list.id},watchlist_id.is.null`) : query.eq("watchlist_id", list.id);

  const { data, error } = await query;
  if (error) throw error;
  return Array.from(new Set((data ?? []).map((row) => String(row.symbol).toUpperCase())));
}

export async function addToList(listId: string, symbol: string) {
  const userId = await currentUserId();
  if (!userId) return { error: new Error("Signed out") };
  return supabase.from("watchlist").insert({ user_id: userId, symbol, watchlist_id: listId });
}

export async function removeFromList(list: NamedWatchlist, isFirst: boolean, symbols: string[]) {
  const userId = await currentUserId();
  if (!userId) return { error: new Error("Signed out") };

  let query = supabase.from("watchlist").delete().eq("user_id", userId).in("symbol", symbols);
  query = isFirst ? query.or(`watchlist_id.eq.${list.id},watchlist_id.is.null`) : query.eq("watchlist_id", list.id);
  return query;
}
