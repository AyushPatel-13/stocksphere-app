import { supabase } from "./supabase";
import { addActivity } from "./activity";

/**
 * The signed-in member's watchlist, stored in Supabase (`watchlist`:
 * user_id, symbol). Reads throw on a database error so a failure is shown as
 * a failure — never as an empty watchlist.
 */

export async function addToWatchlist(symbol: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const result = await supabase
    .from("watchlist")
    .insert({
      user_id: user.id,
      symbol,
    });

  if (!result.error) await addActivity(`⭐ Added ${symbol} to Watchlist`);

  return result;
}

export async function removeFromWatchlist(symbol: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const result = await supabase
    .from("watchlist")
    .delete()
    .eq("user_id", user.id)
    .eq("symbol", symbol);

  if (!result.error) await addActivity(`❌ Removed ${symbol} from Watchlist`);

  return result;
}

export async function getWatchlist(): Promise<{ symbol: string }[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data, error } = await supabase
    .from("watchlist")
    .select("symbol")
    .eq("user_id", user.id);

  if (error) throw error;
  return data ?? [];
}

export async function isInWatchlist(symbol: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return false;

  const { data } = await supabase
    .from("watchlist")
    .select("id")
    .eq("user_id", user.id)
    .eq("symbol", symbol)
    .maybeSingle();

  return !!data;
}
